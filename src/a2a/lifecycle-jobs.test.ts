import type { Task } from '@a2a-js/sdk'
import { captureWithFingerprint } from '@fohte/service-kit/observability'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { startTaskLifecycleJobs } from '@/a2a/lifecycle-jobs'
import type { A2aTaskStore } from '@/a2a/postgres-task-store'

vi.mock('@fohte/service-kit/observability', () => ({
  captureWithFingerprint: vi.fn(),
}))

const buildTask = (id: string): Task => ({
  kind: 'task',
  id,
  contextId: `ctx-${id}`,
  status: { state: 'failed', timestamp: new Date().toISOString() },
})

const buildStore = (overrides: Partial<A2aTaskStore> = {}): A2aTaskStore => ({
  save: vi.fn(),
  load: vi.fn(),
  failStuckWorkingTasks: vi.fn().mockResolvedValue([]),
  deleteExpiredTerminalTasks: vi.fn().mockResolvedValue(0),
  ...overrides,
})

describe('startTaskLifecycleJobs', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('runs the watchdog and retention sweeps once at startup', async () => {
    const store = buildStore()

    const jobs = startTaskLifecycleJobs(store, {
      workingTimeoutMs: 60_000,
      retentionDays: 7,
      onExpire: vi.fn(),
      intervalMs: 1_000_000,
    })
    await jobs.stop()

    expect(store.failStuckWorkingTasks).toHaveBeenCalledTimes(1)
    expect(store.deleteExpiredTerminalTasks).toHaveBeenCalledTimes(1)
  })

  it('invokes onExpire once per task the watchdog fails', async () => {
    const expiredTask = buildTask('task-1')
    const store = buildStore({
      failStuckWorkingTasks: vi.fn().mockResolvedValue([expiredTask]),
    })
    const onExpire = vi.fn().mockResolvedValue(undefined)

    const jobs = startTaskLifecycleJobs(store, {
      workingTimeoutMs: 60_000,
      retentionDays: 7,
      onExpire,
      intervalMs: 1_000_000,
    })
    await jobs.stop()

    expect(onExpire).toHaveBeenCalledExactlyOnceWith(expiredTask)
  })

  const runOnExpireRejectionScenario = async (): Promise<{
    taskA: Task
    taskB: Task
    store: A2aTaskStore
    onExpire: ReturnType<typeof vi.fn>
    error: Error
  }> => {
    const taskA = buildTask('task-a')
    const taskB = buildTask('task-b')
    const store = buildStore({
      failStuckWorkingTasks: vi.fn().mockResolvedValue([taskA, taskB]),
    })
    const error = new Error('push failed')
    const onExpire = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(error))
      .mockImplementationOnce(() => Promise.resolve())

    const jobs = startTaskLifecycleJobs(store, {
      workingTimeoutMs: 60_000,
      retentionDays: 7,
      onExpire,
      intervalMs: 1_000_000,
    })
    await jobs.stop()

    return { taskA, taskB, store, onExpire, error }
  }

  it('runs onExpire for every expired task even if an earlier one rejects, and still runs retention', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { taskA, taskB, store, onExpire } =
      await runOnExpireRejectionScenario()

    expect(onExpire.mock.calls).toEqual([[taskA], [taskB]])
    expect(store.deleteExpiredTerminalTasks).toHaveBeenCalledTimes(1)
  })

  it('reports a failing onExpire callback to Sentry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { taskA, error } = await runOnExpireRejectionScenario()

    expect(captureWithFingerprint).toHaveBeenCalledExactlyOnceWith(
      error,
      'a2a.lifecycle.on-expire-failed',
      { extras: { taskId: taskA.id } },
    )
  })

  it('sweeps again on each interval tick after the startup run', async () => {
    vi.useFakeTimers()
    const store = buildStore()

    const jobs = startTaskLifecycleJobs(store, {
      workingTimeoutMs: 60_000,
      retentionDays: 7,
      onExpire: vi.fn(),
      intervalMs: 1_000,
    })

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await jobs.stop()

    expect(store.failStuckWorkingTasks).toHaveBeenCalledTimes(3)
  })

  it('keeps sweeping on later ticks even if an earlier sweep throws', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let call = 0
    const store = buildStore({
      failStuckWorkingTasks: vi.fn().mockImplementation(() => {
        call += 1
        return call === 1
          ? Promise.reject(new Error('boom'))
          : Promise.resolve([])
      }),
    })

    const jobs = startTaskLifecycleJobs(store, {
      workingTimeoutMs: 60_000,
      retentionDays: 7,
      onExpire: vi.fn(),
      intervalMs: 1_000,
    })

    await vi.advanceTimersByTimeAsync(1_000)
    await jobs.stop()

    expect(store.failStuckWorkingTasks).toHaveBeenCalledTimes(2)
  })

  it('reports a failing sweep to Sentry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('boom')
    const store = buildStore({
      failStuckWorkingTasks: vi.fn().mockRejectedValue(error),
    })

    const jobs = startTaskLifecycleJobs(store, {
      workingTimeoutMs: 60_000,
      retentionDays: 7,
      onExpire: vi.fn(),
      intervalMs: 1_000_000,
    })
    await jobs.stop()

    expect(captureWithFingerprint).toHaveBeenCalledExactlyOnceWith(
      error,
      'a2a.lifecycle.sweep-failed',
    )
  })

  it('derives the watchdog and retention cutoffs from the configured options', async () => {
    const now = Date.now()
    const store = buildStore()

    const jobs = startTaskLifecycleJobs(store, {
      workingTimeoutMs: 60_000,
      retentionDays: 7,
      onExpire: vi.fn(),
      intervalMs: 1_000_000,
    })
    await jobs.stop()

    // A generous 5s tolerance around the expected cutoff absorbs test
    // execution time without asserting exact timer precision.
    const TOLERANCE_MS = 5_000
    const workingCutoff = vi.mocked(store.failStuckWorkingTasks).mock
      .calls[0]?.[0]
    const retentionCutoff = vi.mocked(store.deleteExpiredTerminalTasks).mock
      .calls[0]?.[0]
    if (
      !(workingCutoff instanceof Date) ||
      !(retentionCutoff instanceof Date)
    ) {
      throw new Error('expected both sweeps to receive a Date cutoff')
    }
    expect(Math.abs(now - 60_000 - workingCutoff.getTime())).toBeLessThan(
      TOLERANCE_MS,
    )
    expect(
      Math.abs(now - 7 * 24 * 60 * 60 * 1000 - retentionCutoff.getTime()),
    ).toBeLessThan(TOLERANCE_MS)
  })
})
