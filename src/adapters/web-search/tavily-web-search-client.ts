import { err, ok, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import {
  type WebSearchClient,
  WebSearchError,
  WebSearchRateLimitError,
} from '@/adapters/web-search/web-search-client'

const DEFAULT_ENDPOINT = 'https://api.tavily.com/search'
const DEFAULT_LIMIT = 5

export interface TavilyWebSearchClientConfig {
  readonly apiKey: string
  readonly endpoint?: string
  readonly fetch?: typeof fetch
}

const tavilyResultSchema = z.object({
  title: z.string().optional().default(''),
  url: z.string().min(1),
  content: z.string().optional().default(''),
})

const tavilyResponseSchema = z.object({
  results: z.array(tavilyResultSchema).default([]),
})

export class WebSearchInvalidResponseError extends WebSearchError {
  constructor(
    public readonly issues: z.ZodError,
    public readonly raw: unknown,
  ) {
    super(`web search returned an invalid response: ${issues.message}`)
    this.name = 'WebSearchInvalidResponseError'
    this.cause = issues
  }
}

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

export const createTavilyWebSearchClient = (
  config: TavilyWebSearchClientConfig,
): WebSearchClient => {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT
  const fetchImpl = config.fetch ?? fetch

  return {
    search(query, options = {}) {
      const limit = options.limit ?? DEFAULT_LIMIT

      return ResultAsync.fromPromise(
        fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            query,
            max_results: limit,
          }),
        }),
        (caughtErr) =>
          new WebSearchError(
            `web search request failed: ${errorMessage(caughtErr)}`,
          ),
      )
        .andThen((res) => {
          if (res.status === 429) return err(new WebSearchRateLimitError())
          if (!res.ok) {
            return err(
              new WebSearchError(
                `web search failed with status ${String(res.status)}`,
                res.status,
              ),
            )
          }
          return ResultAsync.fromPromise(
            res.json(),
            (cause) =>
              new WebSearchError(
                `failed to parse web search response: ${errorMessage(cause)}`,
                res.status,
              ),
          )
        })
        .andThen((raw) => {
          const parsed = tavilyResponseSchema.safeParse(raw)
          if (!parsed.success) {
            return err(new WebSearchInvalidResponseError(parsed.error, raw))
          }
          return ok({
            snippets: parsed.data.results.map((r) => ({
              title: r.title,
              url: r.url,
              text: r.content,
            })),
          })
        })
    },
  }
}
