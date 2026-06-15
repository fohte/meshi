import {
  type WebSearchClient,
  WebSearchError,
  type WebSearchOptions,
  WebSearchRateLimitError,
  type WebSearchResult,
  type WebSearchSnippet,
} from '@/adapters/web-search/web-search-client'

const DEFAULT_ENDPOINT = 'https://api.tavily.com/search'
const DEFAULT_LIMIT = 5

export interface TavilyWebSearchClientConfig {
  readonly apiKey: string
  readonly endpoint?: string
  readonly fetch?: typeof fetch
}

interface TavilyRawResult {
  readonly title?: unknown
  readonly url?: unknown
  readonly content?: unknown
}

const toSnippet = (raw: unknown): WebSearchSnippet | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as TavilyRawResult
  const title = typeof r.title === 'string' ? r.title : ''
  const url = typeof r.url === 'string' ? r.url : ''
  const text = typeof r.content === 'string' ? r.content : ''
  if (url === '') return null
  return { title, url, text }
}

const extractResults = (body: unknown): ReadonlyArray<unknown> => {
  if (typeof body !== 'object' || body === null) return []
  const results = (body as { results?: unknown }).results
  if (!Array.isArray(results)) return []
  return results
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

      let body: unknown
      try {
        body = await res.json()
      } catch (cause) {
        throw new WebSearchError(
          `failed to parse web search response: ${cause instanceof Error ? cause.message : String(cause)}`,
          res.status,
        )
      }
      const snippets: WebSearchSnippet[] = []
      for (const raw of extractResults(body)) {
        const snippet = toSnippet(raw)
        if (snippet !== null) snippets.push(snippet)
      }
      return { snippets }
    },
  }
}
