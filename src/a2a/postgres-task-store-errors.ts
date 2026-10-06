import type { ZodError } from 'zod'

export class TaskStorePersistenceError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause })
    this.name = 'TaskStorePersistenceError'
  }
}

export class TaskRowInvalidError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly issues: ZodError,
  ) {
    super(`a2a_tasks row for ${taskId} is not a valid Task: ${issues.message}`)
    this.name = 'TaskRowInvalidError'
    this.cause = issues
  }
}
