import type { Task } from '@a2a-js/sdk'

import type { A2aTaskStore } from '@/a2a/postgres-task-store'

export interface TaskLifecycleJobsOptions {
  // Watchdog threshold: a `working` task whose heartbeat (status_timestamp)
  // has been silent for longer than this is failed. This is a heartbeat
  // timeout, not a max execution time — a slow-but-alive executor keeps
  // publishing status-updates and never crosses it.
  workingTimeoutMs: number
  // Retention: a terminal-state task older than this many days is deleted.
  retentionDays: number
  // Runs after a task is failed by the watchdog, so the caller can push a
  // notification for it (the failing UPDATE itself doesn't notify anyone).
  onExpire: (task: Task) => Promise<void>
  // Sweep interval; not part of the shared design contract, since it's an
  // operational tuning knob rather than a lifecycle semantic.
  intervalMs?: number
}

const DEFAULT_INTERVAL_MS = 60_000
const MS_PER_DAY = 24 * 60 * 60 * 1000

const runSweep = async (
  store: A2aTaskStore,
  options: TaskLifecycleJobsOptions,
): Promise<void> => {
  const workingCutoff = new Date(Date.now() - options.workingTimeoutMs)
  const expired = await store.failStuckWorkingTasks(workingCutoff)
  for (const task of expired) {
    await options.onExpire(task)
  }

  const retentionCutoff = new Date(
    Date.now() - options.retentionDays * MS_PER_DAY,
  )
  await store.deleteExpiredTerminalTasks(retentionCutoff)
}

// Periodic watchdog (fail stuck `working` tasks) + retention (delete expired
// terminal tasks) sweep, run on the same interval and also once at startup —
// the same interval + startup-run idiom used by this codebase's other
// reconciler-shaped jobs.
export const startTaskLifecycleJobs = (
  store: A2aTaskStore,
  options: TaskLifecycleJobsOptions,
): { stop(): Promise<void> } => {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS

  const tick = (previous: Promise<void>): Promise<void> =>
    previous
      .then(() => runSweep(store, options))
      .catch((err: unknown) => {
        console.error('a2a task lifecycle sweep failed:', err)
      })

  let inFlight = tick(Promise.resolve())
  const timer = setInterval(() => {
    inFlight = tick(inFlight)
  }, intervalMs)

  return {
    async stop() {
      clearInterval(timer)
      await inFlight
    },
  }
}
