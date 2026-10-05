import type { ZodError } from 'zod'

import { WebSearchError } from '#adapters/web-search/web-search-client'

export class WebSearchInvalidResponseError extends WebSearchError {
  constructor(
    public readonly issues: ZodError,
    public readonly raw: unknown,
  ) {
    super(`web search returned an invalid response: ${issues.message}`)
    this.name = 'WebSearchInvalidResponseError'
    this.cause = issues
  }
}
