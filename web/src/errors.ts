// Preserve boundary type names and causes for callers handling API errors.
export abstract class BoundaryError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause })
    this.name = new.target.name
  }
}
