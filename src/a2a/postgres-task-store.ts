import type { Task } from '@a2a-js/sdk'
import type { TaskStore } from '@a2a-js/sdk/server'
import { z } from 'zod'

import { createAsText, type Sql } from '@/db'

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
// jobs need sweep queries (fail-stuck, delete-expired) the interface
// doesn't expose.
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

// Every timestamp and the `task` payload below are bound as an explicit
// text parameter (`asText`, from createAsText in @/db) with an inline SQL
// cast, rather than interpolated as a raw `Date`/object or left for
// postgres.js to infer a type for. Two independent Postgres/driver
// behaviors make this necessary, not just defensive:
//
// 1. In production wiring (main.ts), this store's `sql` is the same
//    connection pool that createDrizzleMealLogRepository and
//    createDrizzleUserProfileRepository each build a `drizzle()` instance
//    on. drizzle-orm's postgres-js driver mutates that shared pool's
//    `options.serializers` for timestamp/date OIDs and for jsonb
//    (114/3802) to an identity pass-through as a side effect of
//    construction (drizzle-orm/postgres-js/driver.js `construct()`), for
//    the lifetime of the pool. A `Date`/object routed through one of
//    those OIDs then reaches postgres.js's string wire encoder
//    unconverted and throws `TypeError [ERR_INVALID_ARG_TYPE]`.
// 2. Independent of that corruption, a jsonb-typed parameter whose OID
//    postgres.js leaves unspecified (the default for a plain JS string)
//    is bound to Postgres's `unknown` pseudo-type; casting an `unknown`
//    parameter to `jsonb` re-encodes the text as a JSON *string* instead
//    of parsing it as JSON (confirmed locally: an unknown-OID text
//    parameter cast with `::jsonb` reports `jsonb_typeof = 'string'`, not
//    `'object'`, and fails this table's `jsonb_typeof(task) = 'object'`
//    check constraint). Declaring the parameter's OID as text explicitly
//    routes around Postgres's `unknown`-cast resolution entirely.

export const createPostgresTaskStore = (sql: Sql): A2aTaskStore => {
  const asText = createAsText(sql)

  return {
    async save(task: Task): Promise<void> {
      const statusTimestamp =
        task.status.timestamp !== undefined
          ? new Date(task.status.timestamp)
          : new Date()

      const taskJson = JSON.stringify(task)
      await sql`
        INSERT INTO a2a_tasks (task_id, context_id, state, status_timestamp, task)
        VALUES (${task.id}, ${task.contextId}, ${task.status.state}, ${asText(statusTimestamp.toISOString())}::timestamptz, ${asText(taskJson)}::jsonb)
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
        WHERE state = 'working' AND status_timestamp < ${asText(olderThan.toISOString())}::timestamptz
        RETURNING task_id, task
      `

      return rows.map((row) => {
        const { task_id: taskId } = taskIdRowSchema.parse(row)
        return parseTaskRow(taskId, row['task'])
      })
    },

    async deleteExpiredTerminalTasks(olderThan: Date): Promise<number> {
      // Both deletes happen in one statement (via data-modifying CTEs) so
      // a2a_push_configs can never be left with rows orphaned by a
      // half-applied cleanup — a single statement is atomic on its own,
      // without needing an explicit transaction wrapper.
      const deleted = await sql`
        WITH deleted_tasks AS (
          DELETE FROM a2a_tasks
          WHERE state IN ${sql(TERMINAL_STATES)} AND status_timestamp < ${asText(olderThan.toISOString())}::timestamptz
          RETURNING task_id
        ),
        deleted_configs AS (
          DELETE FROM a2a_push_configs
          WHERE task_id IN (SELECT task_id FROM deleted_tasks)
          RETURNING task_id
        )
        SELECT task_id FROM deleted_tasks
      `
      return deleted.length
    },
  }
}
