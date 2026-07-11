import type { Task } from '@a2a-js/sdk'
import type { TaskStore } from '@a2a-js/sdk/server'
import { z } from 'zod'

import type { Sql } from '@/db'

// Rows in a terminal state must never be overwritten by a later save() — the
// watchdog may have already failed a task that a still-running executor
// then tries to complete. This condition backs the `ON CONFLICT ... WHERE`
// guard below and the watchdog's own `state = 'working'` update predicate.
const TERMINAL_STATES = ['completed', 'failed', 'canceled', 'rejected'] as const

// Raw SQL throughout, not the drizzle query builder: this store leans on
// `jsonb_set` and a conditional `ON CONFLICT ... WHERE` the builder can't
// express, and constructing a `drizzle()` instance on the same connection
// used for raw queries corrupts jsonb round-tripping under the test
// harness's tx setup (see setupDrizzleTx's caveat in src/test/db.ts) —
// staying off the query builder entirely for this table sidesteps that.

// The `task` column is written exclusively by `save()` below, which only
// ever receives real `Task` values from the SDK, but it's read back across
// process restarts and across replicas that may be running different
// meshi versions during a rolling deploy. This schema checks just enough
// of the envelope to safely cast the rest through.
const taskEnvelopeSchema = z
  .object({
    kind: z.literal('task'),
    id: z.string(),
    contextId: z.string(),
    status: z.object({ state: z.string() }).loose(),
  })
  .loose()

const taskIdRowSchema = z.object({ task_id: z.string() })

export class TaskRowInvalidError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly issues: z.ZodError,
  ) {
    super(`a2a_tasks row for ${taskId} is not a valid Task: ${issues.message}`)
    this.name = 'TaskRowInvalidError'
    this.cause = issues
  }
}

// Superset of the SDK's `TaskStore` interface: the watchdog and retention
// jobs need sweep queries the interface doesn't expose (v1.0 will add a
// required `list()`, so this store already carries list-shaped queries).
export interface A2aTaskStore extends TaskStore {
  // Fails tasks stuck in `working` whose heartbeat (status_timestamp) is
  // older than `olderThan`, returning the tasks that were transitioned so
  // the caller can run its push-notification hook.
  failStuckWorkingTasks: (olderThan: Date) => Promise<readonly Task[]>
  // Deletes terminal-state tasks whose status_timestamp is older than
  // `olderThan`, along with any push notification configs left for them.
  // Returns the number of tasks deleted.
  deleteExpiredTerminalTasks: (olderThan: Date) => Promise<number>
}

const parseTaskRow = (taskId: string, rawTask: unknown): Task => {
  const parsed = taskEnvelopeSchema.safeParse(rawTask)
  if (!parsed.success) {
    throw new TaskRowInvalidError(taskId, parsed.error)
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- taskEnvelopeSchema validates the fields this store depends on; the rest of the shape is trusted to the SDK types that produced it.
  return parsed.data as Task
}

export const createPostgresTaskStore = (sql: Sql): A2aTaskStore => {
  return {
    async save(task: Task): Promise<void> {
      const statusTimestamp =
        task.status.timestamp !== undefined
          ? new Date(task.status.timestamp)
          : new Date()

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `task` is always a JSON-serializable SDK value; postgres-js's JSONValue type has no way to express an arbitrary interface satisfies it.
      const taskJson = sql.json(task as never)
      await sql`
        INSERT INTO a2a_tasks (task_id, context_id, state, status_timestamp, task)
        VALUES (${task.id}, ${task.contextId}, ${task.status.state}, ${statusTimestamp}, ${taskJson})
        ON CONFLICT (task_id) DO UPDATE SET
          context_id = EXCLUDED.context_id,
          state = EXCLUDED.state,
          status_timestamp = EXCLUDED.status_timestamp,
          task = EXCLUDED.task
        WHERE a2a_tasks.state NOT IN ${sql(TERMINAL_STATES)}
      `
    },

    async load(taskId: string): Promise<Task | undefined> {
      const rows = await sql`
        SELECT task FROM a2a_tasks WHERE task_id = ${taskId}
      `
      const row = rows[0]
      if (row === undefined) return undefined
      return parseTaskRow(taskId, row['task'])
    },

    async failStuckWorkingTasks(olderThan: Date): Promise<readonly Task[]> {
      const nowIso = new Date().toISOString()
      const rows = await sql`
        UPDATE a2a_tasks
        SET
          state = 'failed',
          status_timestamp = now(),
          task = jsonb_set(
            jsonb_set(task, '{status,state}', '"failed"'),
            '{status,timestamp}',
            to_jsonb(${nowIso}::text)
          )
        WHERE state = 'working' AND status_timestamp < ${olderThan}
        RETURNING task_id, task
      `

      return rows.map((row) => {
        const { task_id: taskId } = taskIdRowSchema.parse(row)
        return parseTaskRow(taskId, row['task'])
      })
    },

    async deleteExpiredTerminalTasks(olderThan: Date): Promise<number> {
      const deleted = await sql`
        DELETE FROM a2a_tasks
        WHERE state IN ${sql(TERMINAL_STATES)} AND status_timestamp < ${olderThan}
        RETURNING task_id
      `
      if (deleted.length === 0) return 0

      const taskIds = deleted.map((row) => taskIdRowSchema.parse(row).task_id)
      await sql`DELETE FROM a2a_push_configs WHERE task_id IN ${sql(taskIds)}`
      return deleted.length
    },
  }
}
