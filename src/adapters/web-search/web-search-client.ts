import type { ResultAsync } from 'neverthrow'

export interface WebSearchSnippet {
  readonly title: string
  readonly url: string
  readonly text: string
}

export interface WebSearchResult {
  readonly snippets: ReadonlyArray<WebSearchSnippet>
}

export interface WebSearchOptions {
  readonly limit?: number
}

export interface WebSearchClient {
  search(
    query: string,
    options?: WebSearchOptions,
  ): ResultAsync<WebSearchResult, WebSearchError>
}

export class WebSearchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'WebSearchError'
  }
}

export class WebSearchRateLimitError extends WebSearchError {
  constructor(message = 'web search rate limit exceeded') {
    super(message, 429)
    this.name = 'WebSearchRateLimitError'
  }
}
