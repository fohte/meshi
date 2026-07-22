import type { PushNotificationConfig } from '@a2a-js/sdk'
import type { PushNotificationStore } from '@a2a-js/sdk/server'
import { captureWithFingerprint } from '@fohte/service-kit/observability'
import { z } from 'zod'

import { createAsText, type Sql } from '@/db'

// Raw SQL, not the drizzle query builder: this table shares a connection
// pool with PostgresTaskStore in production wiring (main.ts), and
// constructing a drizzle() instance on that pool corrupts serialization of
// any raw `Date`/object interpolated into a `sql` template afterward (see
// the comment in postgres-task-store.ts). `config` below is bound as an
// explicit text parameter (`asText`) for the same two reasons `task` is
// there.

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

export class PushNotificationStorePersistenceError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause })
    this.name = 'PushNotificationStorePersistenceError'
  }
}

const PUSH_NOTIFICATION_STORE_FINGERPRINT =
  'a2a.push-notification-store.persistence-error'

export const createPostgresPushNotificationStore = (
  sql: Sql,
): PushNotificationStore => {
  const asText = createAsText(sql)

  return {
    async save(
      taskId: string,
      pushNotificationConfig: PushNotificationConfig,
    ): Promise<void> {
      // Matches InMemoryPushNotificationStore: callers (e.g. message/send with
      // configuration.pushNotificationConfig) don't always set an id.
      const configId = pushNotificationConfig.id ?? taskId
      const config = { ...pushNotificationConfig, id: configId }

      try {
        const configJson = JSON.stringify(config)
        await sql`
          INSERT INTO a2a_push_configs (task_id, config_id, config)
          VALUES (${taskId}, ${configId}, ${asText(configJson)}::jsonb)
          ON CONFLICT (task_id, config_id) DO UPDATE SET
            config = EXCLUDED.config
        `
      } catch (caughtErr) {
        const wrapped = new PushNotificationStorePersistenceError(
          `failed to save push_config for task ${taskId}`,
          caughtErr,
        )
        captureWithFingerprint(wrapped, PUSH_NOTIFICATION_STORE_FINGERPRINT, {
          extras: { taskId, configId, method: 'save' },
        })
        throw wrapped
      }
    },

    async load(taskId: string): Promise<PushNotificationConfig[]> {
      try {
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
      } catch (caughtErr) {
        const wrapped = new PushNotificationStorePersistenceError(
          `failed to load push_configs for task ${taskId}`,
          caughtErr,
        )
        captureWithFingerprint(wrapped, PUSH_NOTIFICATION_STORE_FINGERPRINT, {
          extras: { taskId, method: 'load' },
        })
        throw wrapped
      }
    },

    async delete(taskId: string, configId?: string): Promise<void> {
      // Matches InMemoryPushNotificationStore: an omitted configId falls
      // back to taskId (the default id assigned in save() above), not to
      // "delete every config for this task".
      const resolvedConfigId = configId ?? taskId
      try {
        await sql`
          DELETE FROM a2a_push_configs
          WHERE task_id = ${taskId} AND config_id = ${resolvedConfigId}
        `
      } catch (caughtErr) {
        const wrapped = new PushNotificationStorePersistenceError(
          `failed to delete push_config for task ${taskId}`,
          caughtErr,
        )
        captureWithFingerprint(wrapped, PUSH_NOTIFICATION_STORE_FINGERPRINT, {
          extras: { taskId, configId: resolvedConfigId, method: 'delete' },
        })
        throw wrapped
      }
    },
  }
}
