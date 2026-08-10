// Base for domain errors shaped as a closed error-code union plus a details
// bag (as opposed to meal-log's DomainError, whose subclasses carry their
// own typed fields instead of a generic details record).
export abstract class CodedDomainError<Code extends string> extends Error {
  readonly code: Code
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    code: Code,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.code = code
    this.details = details
  }
}
