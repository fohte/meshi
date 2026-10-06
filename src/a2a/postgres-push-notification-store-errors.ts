import type { ZodError } from 'zod'

export class PushConfigRowInvalidError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly issues: ZodError,
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
