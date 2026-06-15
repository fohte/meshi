import { z } from 'zod'

import {
  type WebSearchClient,
  WebSearchError,
  type WebSearchOptions,
  WebSearchRateLimitError,
  type WebSearchResult,
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

export const createTavilyWebSearchClient = (
  config: TavilyWebSearchClientConfig,
): WebSearchClient => {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT
  const fetchImpl = config.fetch ?? fetch

  return {
    async search(
      query: string,
      options: WebSearchOptions = {},
    ): Promise<WebSearchResult> {
      const limit = options.limit ?? DEFAULT_LIMIT

      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: limit,
        }),
      })

      if (res.status === 429) throw new WebSearchRateLimitError()
      if (!res.ok) {
        throw new WebSearchError(
          `web search failed with status ${String(res.status)}`,
          res.status,
        )
      }

      let raw: unknown
      try {
        raw = await res.json()
      } catch (cause) {
        throw new WebSearchError(
          `failed to parse web search response: ${cause instanceof Error ? cause.message : String(cause)}`,
          res.status,
        )
      }
      const parsed = tavilyResponseSchema.safeParse(raw)
      if (!parsed.success) {
        throw new WebSearchInvalidResponseError(parsed.error, raw)
      }
      return {
        snippets: parsed.data.results.map((r) => ({
          title: r.title,
          url: r.url,
          text: r.content,
        })),
      }
    },
  }
}
