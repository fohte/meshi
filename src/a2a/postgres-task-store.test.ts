import type { Task } from '@a2a-js/sdk'
import { captureWithFingerprint } from '@fohte/service-kit/observability'
import { describe, expect, it, test, vi } from 'vitest'

import {
  createPostgresTaskStore,
  TaskRowInvalidError,
  TaskStorePersistenceError,
} from '@/a2a/postgres-task-store'
import type { Sql } from '@/db'
import { captureSqlParams, describeIfDb, setupTx } from '@/test/db'
import { seedA2aPushConfig } from '@/test/seed'

vi.mock('@fohte/service-kit/observability', () => ({
  captureWithFingerprint: vi.fn(),
}))

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

// The SDK's DefaultRequestHandler catches whatever save()/load() throw and
// only console.errors it — there is no callback for propagating that error
// out to the caller. These tests don't need a real database: they pin that
// a failure reaching `sql` (or a row that fails parseTaskRow's schema
// check) is wrapped, reported to Sentry, and rethrown before it can
// disappear into that silent catch.
describe('error reporting', () => {
  // Minimal fake of postgres.Sql's tagged-template call plus .typed(),
  // mirroring captureSqlParams in src/test/db.ts — a non-tagged call (e.g.
  // sql(TERMINAL_STATES) for an `IN (...)` list) is passed through
  // unchanged, and a tagged-template call resolves to `outcome`.
  const buildFakeSql = (
    outcome: { reject: Error } | { resolve: unknown[] },
  ): Sql => {
    const tag = (first: TemplateStringsArray | readonly string[]): unknown => {
      if (!('raw' in first)) return first
      return 'reject' in outcome
        ? Promise.reject(outcome.reject)
        : Promise.resolve(outcome.resolve)
    }
    const fakeSql = Object.assign(tag, { typed: (value: unknown) => value })
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal fake of postgres.Sql's tagged-template call plus .typed(); only the surface exercised by the store under test.
    return fakeSql as unknown as Sql
  }

  const rejectedError = async (promise: Promise<unknown>): Promise<unknown> =>
    promise.then(
      () => {
        throw new Error('expected the promise to reject')
      },
      (err: unknown) => err,
    )

  const runSaveFailure = async (dbError: Error): Promise<unknown> => {
    const store = createPostgresTaskStore(buildFakeSql({ reject: dbError }))
    const task = buildTask({
      id: 'task-save-fail',
      contextId: 'ctx-save-fail',
      state: 'submitted',
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
    })
    return rejectedError(store.save(task))
  }

  it('wraps and rethrows a save failure as TaskStorePersistenceError', async () => {
    const dbError = new Error('connection terminated')
    const thrown = await runSaveFailure(dbError)
    if (!(thrown instanceof TaskStorePersistenceError)) {
      throw new Error('expected save() to throw a TaskStorePersistenceError')
    }

    expect(thrown.message).toBe('failed to save a2a_task task-save-fail')
    expect(thrown.cause).toBe(dbError)
  })

  it('reports a save failure to Sentry', async () => {
    const dbError = new Error('connection terminated')
    const thrown = await runSaveFailure(dbError)

    expect(vi.mocked(captureWithFingerprint).mock.calls).toEqual([
      [
        thrown,
        'a2a.task-store.persistence-error',
        { extras: { taskId: 'task-save-fail', method: 'save' } },
      ],
    ])
  })

  const runLoadFailure = async (dbError: Error): Promise<unknown> => {
    const store = createPostgresTaskStore(buildFakeSql({ reject: dbError }))
    return rejectedError(store.load('task-load-fail'))
  }

  it('wraps and rethrows a load failure as TaskStorePersistenceError', async () => {
    const dbError = new Error('connection terminated')
    const thrown = await runLoadFailure(dbError)
    if (!(thrown instanceof TaskStorePersistenceError)) {
      throw new Error('expected load() to throw a TaskStorePersistenceError')
    }

    expect(thrown.message).toBe('failed to load a2a_task task-load-fail')
    expect(thrown.cause).toBe(dbError)
  })

  it('reports a load failure to Sentry', async () => {
    const dbError = new Error('connection terminated')
    const thrown = await runLoadFailure(dbError)

    expect(vi.mocked(captureWithFingerprint).mock.calls).toEqual([
      [
        thrown,
        'a2a.task-store.persistence-error',
        { extras: { taskId: 'task-load-fail', method: 'load' } },
      ],
    ])
  })

  const runInvalidRowLoadFailure = async (): Promise<unknown> => {
    const store = createPostgresTaskStore(
      buildFakeSql({ resolve: [{ task: { kind: 'not-a-task' } }] }),
    )
    return rejectedError(store.load('task-bad-row'))
  }

  it('wraps and rethrows an invalid task row as TaskStorePersistenceError', async () => {
    const thrown = await runInvalidRowLoadFailure()
    if (!(thrown instanceof TaskStorePersistenceError)) {
      throw new Error('expected load() to throw a TaskStorePersistenceError')
    }

    expect(thrown.message).toBe('failed to load a2a_task task-bad-row')
    expect(thrown.cause).toBeInstanceOf(TaskRowInvalidError)
  })

  it('reports an invalid task row load failure to Sentry', async () => {
    const thrown = await runInvalidRowLoadFailure()

    expect(vi.mocked(captureWithFingerprint).mock.calls).toEqual([
      [
        thrown,
        'a2a.task-store.persistence-error',
        { extras: { taskId: 'task-bad-row', method: 'load' } },
      ],
    ])
  })
})

// Production wiring shares this store's connection pool with drizzle()-
// backed repositories (see the comment in postgres-task-store.ts), which
// corrupts postgres.js's serialization of any raw `Date`/plain-object
// parameter interpolated into a `sql` template afterward. These tests
// don't need a real database — they assert on what createPostgresTaskStore
// hands to its `sql` dependency (a pre-serialized string, not a `Date` or
// object), independent of postgres.js's own parameter-serialization
// behavior.
describe('parameters passed to sql', () => {
  const FIXED_ISO = '2026-01-01T00:00:00.000Z'

  // failStuckWorkingTasks() stamps its own to_jsonb(...) parameter with
  // `new Date().toISOString()`, always the first param bound — normalize
  // it so the rest of the params array can still be compared as a single
  // literal.
  const normalizeGeneratedTimestamp = (params: unknown[]): unknown[] =>
    params.map((param, index) => (index === 0 ? NORMALIZED_TIMESTAMP : param))

  test('save() passes status_timestamp and task as pre-serialized strings', async () => {
    const { sql, params } = captureSqlParams()
    const store = createPostgresTaskStore(sql)
    const task = buildTask({
      id: 'task-param-check',
      contextId: 'ctx-param-check',
      state: 'submitted',
      timestamp: new Date(FIXED_ISO),
    })

    await store.save(task)

    expect(params).toEqual([
      'task-param-check',
      'ctx-param-check',
      'submitted',
      FIXED_ISO,
      JSON.stringify(task),
      ['completed', 'failed', 'canceled', 'rejected'],
    ])
  })

  test('failStuckWorkingTasks() passes olderThan as a string', async () => {
    const { sql, params } = captureSqlParams()
    const store = createPostgresTaskStore(sql)

    await store.failStuckWorkingTasks(new Date(FIXED_ISO))

    expect(normalizeGeneratedTimestamp(params)).toEqual([
      NORMALIZED_TIMESTAMP,
      FIXED_ISO,
    ])
  })

  test('deleteExpiredTerminalTasks() passes olderThan as a string', async () => {
    const { sql, params } = captureSqlParams()
    const store = createPostgresTaskStore(sql)

    await store.deleteExpiredTerminalTasks(new Date(FIXED_ISO))

    expect(params).toEqual([
      ['completed', 'failed', 'canceled', 'rejected'],
      FIXED_ISO,
    ])
  })
})
