export class UserProfileRepositoryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'UserProfileRepositoryError'
  }
}
