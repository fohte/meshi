import type { Task } from '@a2a-js/sdk'
import { describe, expect, it } from 'vitest'

import { createPostgresTaskStore } from '@/a2a/postgres-task-store'
import type { Sql } from '@/db'
import { describeIfDb, setupTx } from '@/test/db'
import { seedA2aPushConfig } from '@/test/seed'

const MS_PER_DAY = 24 * 60 * 60 * 1000

const isoAt = (date: Date): string => date.toISOString()

const buildTask = (task: {
  id: string
  contextId: string
  state: Task['status']['state']
  timestamp: Date
}): Task => ({
  kind: 'task',
  id: task.id,
  contextId: task.contextId,
  status: { state: task.state, timestamp: isoAt(task.timestamp) },
})

const NORMALIZED_TIMESTAMP = 'NORMALIZED'

// The watchdog stamps status.timestamp with the DB's own `now()`, so the
// exact value can't be asserted; normalize it in and compare everything
// else (state, id, contextId) with a single equality check.
const normalizeStatusTimestamp = (task: Task): Task => ({
  ...task,
  status: { ...task.status, timestamp: NORMALIZED_TIMESTAMP },
})

describeIfDb('createPostgresTaskStore', () => {
  const getTx = setupTx()

  describe('save / load', () => {
    it('round-trips a saved task', async () => {
      const store = createPostgresTaskStore(getTx())
      const task = buildTask({
        id: 'task-round-trip',
        contextId: 'ctx-round-trip',
        state: 'submitted',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
      })

      await store.save(task)

      expect(await store.load('task-round-trip')).toEqual(task)
    })

    it('returns undefined for an unknown task id', async () => {
      const store = createPostgresTaskStore(getTx())
      expect(await store.load('does-not-exist')).toBeUndefined()
    })

    it('overwrites a non-terminal task on a later save', async () => {
      const store = createPostgresTaskStore(getTx())
      const submitted = buildTask({
        id: 'task-progress',
        contextId: 'ctx-progress',
        state: 'submitted',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
      })
      await store.save(submitted)

      const working = buildTask({
        id: 'task-progress',
        contextId: 'ctx-progress',
        state: 'working',
        timestamp: new Date('2026-01-01T00:01:00.000Z'),
      })
      await store.save(working)

      expect(await store.load('task-progress')).toEqual(working)
    })

    it('rejects an update once the task has reached a terminal state', async () => {
      const store = createPostgresTaskStore(getTx())
      const completed = buildTask({
        id: 'task-terminal',
        contextId: 'ctx-terminal',
        state: 'completed',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
      })
      await store.save(completed)

      const staleWorking = buildTask({
        id: 'task-terminal',
        contextId: 'ctx-terminal',
        state: 'working',
        timestamp: new Date('2026-01-01T00:05:00.000Z'),
      })
      await store.save(staleWorking)

      expect(await store.load('task-terminal')).toEqual(completed)
    })
  })

  describe('failStuckWorkingTasks', () => {
    it('fails a working task whose heartbeat has gone stale', async () => {
      const store = createPostgresTaskStore(getTx())
      const stale = buildTask({
        id: 'task-stale',
        contextId: 'ctx-stale',
        state: 'working',
        timestamp: new Date(Date.now() - 20 * 60_000),
      })
      await store.save(stale)

      const expired = await store.failStuckWorkingTasks(
        new Date(Date.now() - 10 * 60_000),
      )

      const expectedFailed = {
        ...stale,
        status: { state: 'failed' as const, timestamp: NORMALIZED_TIMESTAMP },
      }
      expect(expired.map(normalizeStatusTimestamp)).toEqual([expectedFailed])

      const loaded = await store.load('task-stale')
      if (loaded === undefined) {
        throw new Error('expected task-stale to still be loadable')
      }
      expect(normalizeStatusTimestamp(loaded)).toEqual(expectedFailed)
    })

    it('does not touch a working task whose heartbeat is still alive', async () => {
      const store = createPostgresTaskStore(getTx())
      const alive = buildTask({
        id: 'task-alive',
        contextId: 'ctx-alive',
        state: 'working',
        timestamp: new Date(),
      })
      await store.save(alive)

      const expired = await store.failStuckWorkingTasks(
        new Date(Date.now() - 10 * 60_000),
      )

      expect(expired).toEqual([])
      expect(await store.load('task-alive')).toEqual(alive)
    })

    it('does not touch a task that is already in a terminal state', async () => {
      const store = createPostgresTaskStore(getTx())
      const oldCompleted = buildTask({
        id: 'task-old-completed',
        contextId: 'ctx-old-completed',
        state: 'completed',
        timestamp: new Date(Date.now() - 20 * 60_000),
      })
      await store.save(oldCompleted)

      const expired = await store.failStuckWorkingTasks(
        new Date(Date.now() - 10 * 60_000),
      )

      expect(expired).toEqual([])
      expect(await store.load('task-old-completed')).toEqual(oldCompleted)
    })

    it('does not touch an input-required task regardless of age', async () => {
      const store = createPostgresTaskStore(getTx())
      const waiting = buildTask({
        id: 'task-waiting',
        contextId: 'ctx-waiting',
        state: 'input-required',
        timestamp: new Date(Date.now() - 20 * 60_000),
      })
      await store.save(waiting)

      const expired = await store.failStuckWorkingTasks(
        new Date(Date.now() - 10 * 60_000),
      )

      expect(expired).toEqual([])
      expect(await store.load('task-waiting')).toEqual(waiting)
    })
  })

  describe('deleteExpiredTerminalTasks', () => {
    it('deletes a terminal task past the retention cutoff, and its push configs', async () => {
      const tx = getTx()
      const store = createPostgresTaskStore(tx)
      const oldFailed = buildTask({
        id: 'task-expired',
        contextId: 'ctx-expired',
        state: 'failed',
        timestamp: new Date(Date.now() - 30 * MS_PER_DAY),
      })
      await store.save(oldFailed)
      await seedA2aPushConfig(tx, {
        taskId: 'task-expired',
        configId: 'task-expired',
        config: { id: 'task-expired', url: 'https://example.com/push' },
      })

      const deletedCount = await store.deleteExpiredTerminalTasks(
        new Date(Date.now() - 7 * MS_PER_DAY),
      )

      expect(deletedCount).toBe(1)
      expect(await store.load('task-expired')).toBeUndefined()
      expect(
        await tx`SELECT * FROM a2a_push_configs WHERE task_id = 'task-expired'`,
      ).toEqual([])
    })

    it('keeps a terminal task inside the retention window', async () => {
      const store = createPostgresTaskStore(getTx())
      const recentCompleted = buildTask({
        id: 'task-recent',
        contextId: 'ctx-recent',
        state: 'completed',
        timestamp: new Date(Date.now() - 1 * MS_PER_DAY),
      })
      await store.save(recentCompleted)

      const deletedCount = await store.deleteExpiredTerminalTasks(
        new Date(Date.now() - 7 * MS_PER_DAY),
      )

      expect(deletedCount).toBe(0)
      expect(await store.load('task-recent')).toEqual(recentCompleted)
    })

    it('keeps a non-terminal task no matter how old', async () => {
      const store = createPostgresTaskStore(getTx())
      const oldWorking = buildTask({
        id: 'task-old-working',
        contextId: 'ctx-old-working',
        state: 'working',
        timestamp: new Date(Date.now() - 30 * MS_PER_DAY),
      })
      await store.save(oldWorking)

      const deletedCount = await store.deleteExpiredTerminalTasks(
        new Date(Date.now() - 7 * MS_PER_DAY),
      )

      expect(deletedCount).toBe(0)
      expect(await store.load('task-old-working')).toEqual(oldWorking)
    })
  })
})

// postgres.js infers a parameter's wire type via a runtime `instanceof
// Date` check (postgres/src/types.js `inferType`); when that check
// doesn't match, a raw `Date` value reaches the string serializer instead
// and throws (`TypeError [ERR_INVALID_ARG_TYPE]` in `Buffer.byteLength`).
// These tests don't need a real database — they assert on what
// createPostgresTaskStore hands to its `sql` dependency, independent of
// postgres.js's own parameter-serialization behavior.
describe('timestamp parameters passed to sql', () => {
  const OLDER_THAN_ISO = '2026-01-01T00:00:00.000Z'

  const captureSqlParams = (): { sql: Sql; params: unknown[] } => {
    const params: unknown[] = []
    const tag = (
      first: TemplateStringsArray | readonly string[],
      ...rest: unknown[]
    ): unknown => {
      if (!('raw' in first)) return first
      params.push(...rest)
      return Promise.resolve([])
    }
    const fakeSql = Object.assign(tag, { json: (value: unknown) => value })
    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal fake of postgres.Sql's tagged-template call plus .json(); only the surface createPostgresTaskStore exercises.
      sql: fakeSql as unknown as Sql,
      params,
    }
  }

  // A `Date` that made it through unconverted would show up here as a
  // `Date` instance instead of the expected ISO string.
  const timestampCandidates = (params: unknown[]): unknown[] =>
    params.filter((param) => param instanceof Date || param === OLDER_THAN_ISO)

  it('save() passes status_timestamp as a string', async () => {
    const { sql, params } = captureSqlParams()
    const store = createPostgresTaskStore(sql)
    const task = buildTask({
      id: 'task-param-check',
      contextId: 'ctx-param-check',
      state: 'submitted',
      timestamp: new Date(OLDER_THAN_ISO),
    })

    await store.save(task)

    expect(timestampCandidates(params)).toEqual([OLDER_THAN_ISO])
  })

  it('failStuckWorkingTasks() passes olderThan as a string', async () => {
    const { sql, params } = captureSqlParams()
    const store = createPostgresTaskStore(sql)

    await store.failStuckWorkingTasks(new Date(OLDER_THAN_ISO))

    expect(timestampCandidates(params)).toEqual([OLDER_THAN_ISO])
  })

  it('deleteExpiredTerminalTasks() passes olderThan as a string', async () => {
    const { sql, params } = captureSqlParams()
    const store = createPostgresTaskStore(sql)

    await store.deleteExpiredTerminalTasks(new Date(OLDER_THAN_ISO))

    expect(timestampCandidates(params)).toEqual([OLDER_THAN_ISO])
  })
})
