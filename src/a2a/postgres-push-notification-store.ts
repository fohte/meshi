import type { PushNotificationConfig } from '@a2a-js/sdk'
import type { PushNotificationStore } from '@a2a-js/sdk/server'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { z } from 'zod'

import type { Sql } from '@/db'
import { a2aPushConfigs } from '@/db/schema'

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
  const db = drizzle(sql)

  return {
    async save(
      taskId: string,
      pushNotificationConfig: PushNotificationConfig,
    ): Promise<void> {
      // Matches InMemoryPushNotificationStore: callers (e.g. message/send with
      // configuration.pushNotificationConfig) don't always set an id.
      const configId = pushNotificationConfig.id ?? taskId
      const config = { ...pushNotificationConfig, id: configId }

      await db
        .insert(a2aPushConfigs)
        .values({ taskId, configId, config })
        .onConflictDoUpdate({
          target: [a2aPushConfigs.taskId, a2aPushConfigs.configId],
          set: { config },
        })
    },

    async load(taskId: string): Promise<PushNotificationConfig[]> {
      const rows = await db
        .select({ config: a2aPushConfigs.config })
        .from(a2aPushConfigs)
        .where(eq(a2aPushConfigs.taskId, taskId))

      return rows.map((row) => {
        const parsed = pushNotificationConfigSchema.safeParse(row.config)
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
      await db
        .delete(a2aPushConfigs)
        .where(
          and(
            eq(a2aPushConfigs.taskId, taskId),
            eq(a2aPushConfigs.configId, configId ?? taskId),
          ),
        )
    },
  }
}
