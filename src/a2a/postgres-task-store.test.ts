import type { Task } from '@a2a-js/sdk'
import { describe, expect, it } from 'vitest'

import { createPostgresTaskStore } from '@/a2a/postgres-task-store'
import { describeIfDb, getTestSql, setupTx } from '@/test/db'
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

      expect(expired.map((t) => ({ id: t.id, state: t.status.state }))).toEqual(
        [{ id: 'task-stale', state: 'failed' }],
      )
      const loaded = await store.load('task-stale')
      expect(loaded?.status.state).toBe('failed')
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

// Sanity check that the store can be constructed against a plain read-only
// connection too (no transaction requirement baked into its API).
describeIfDb('createPostgresTaskStore (read-only)', () => {
  it('returns undefined for a task id on an empty table view', async () => {
    const store = createPostgresTaskStore(getTestSql())
    expect(await store.load('never-inserted-task-id')).toBeUndefined()
  })
})
