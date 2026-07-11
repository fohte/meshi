import type { PushNotificationConfig } from '@a2a-js/sdk'
import type { PushNotificationStore } from '@a2a-js/sdk/server'
import { z } from 'zod'

import type { Sql } from '@/db'

// Raw SQL, not the drizzle query builder: this table shares a connection
// with PostgresTaskStore in production wiring, and constructing a
// drizzle() instance flips jsonb (de)serialization for every query on that
// connection, corrupting the other store's raw reads of `a2a_tasks.task`
// (see the comment in postgres-task-store.ts).

// This store writes and reads the `config` column exclusively; the SDK
// caller only ever passes it a `PushNotificationConfig` it constructed
// itself, but the column is re-read across replicas and process restarts,
// so the shape it depends on (url, id) is checked at read time.
const pushNotificationConfigSchema = z
  .object({
    id: z.string(),
    url: z.string(),
  })
  .loose()

export class PushConfigRowInvalidError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly issues: z.ZodError,
  ) {
    super(
      `a2a_push_configs row for ${taskId} is not a valid PushNotificationConfig: ${issues.message}`,
    )
    this.name = 'PushConfigRowInvalidError'
    this.cause = issues
  }
}

export const createPostgresPushNotificationStore = (
  sql: Sql,
): PushNotificationStore => {
  return {
    async save(
      taskId: string,
      pushNotificationConfig: PushNotificationConfig,
    ): Promise<void> {
      // Matches InMemoryPushNotificationStore: callers (e.g. message/send with
      // configuration.pushNotificationConfig) don't always set an id.
      const configId = pushNotificationConfig.id ?? taskId
      const config = { ...pushNotificationConfig, id: configId }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `config` is always a JSON-serializable SDK value; postgres-js's JSONValue type has no way to express an arbitrary interface satisfies it.
      const configJson = sql.json(config as never)
      await sql`
        INSERT INTO a2a_push_configs (task_id, config_id, config)
        VALUES (${taskId}, ${configId}, ${configJson})
        ON CONFLICT (task_id, config_id) DO UPDATE SET
          config = EXCLUDED.config
      `
    },

    async load(taskId: string): Promise<PushNotificationConfig[]> {
      const rows = await sql`
        SELECT config FROM a2a_push_configs WHERE task_id = ${taskId}
      `

      return rows.map((row) => {
        const parsed = pushNotificationConfigSchema.safeParse(row['config'])
        if (!parsed.success) {
          throw new PushConfigRowInvalidError(taskId, parsed.error)
        }
        return parsed.data
      })
    },

    async delete(taskId: string, configId?: string): Promise<void> {
      // Matches InMemoryPushNotificationStore: an omitted configId falls
      // back to taskId (the default id assigned in save() above), not to
      // "delete every config for this task".
      await sql`
        DELETE FROM a2a_push_configs
        WHERE task_id = ${taskId} AND config_id = ${configId ?? taskId}
      `
    },
  }
}
