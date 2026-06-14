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

const toSnippet = (raw: TavilyRawResult): WebSearchSnippet | null => {
  const title = typeof raw.title === 'string' ? raw.title : ''
  const url = typeof raw.url === 'string' ? raw.url : ''
  const text = typeof raw.content === 'string' ? raw.content : ''
  if (url === '') return null
  return { title, url, text }
}

const extractResults = (body: unknown): ReadonlyArray<TavilyRawResult> => {
  if (typeof body !== 'object' || body === null) return []
  const results = (body as { results?: unknown }).results
  if (!Array.isArray(results)) return []
  return results as ReadonlyArray<TavilyRawResult>
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
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: config.apiKey,
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

      const body: unknown = await res.json()
      const snippets: WebSearchSnippet[] = []
      for (const raw of extractResults(body)) {
        const snippet = toSnippet(raw)
        if (snippet !== null) snippets.push(snippet)
      }
      return { snippets }
    },
  }
}
