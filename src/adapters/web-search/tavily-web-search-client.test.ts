import { describe, expect, it, vi } from 'vitest'

import {
  createTavilyWebSearchClient,
  WebSearchInvalidResponseError,
} from '@/adapters/web-search/tavily-web-search-client'
import {
  WebSearchError,
  WebSearchRateLimitError,
} from '@/adapters/web-search/web-search-client'

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

interface CapturedRequest {
  url: string
  authorization: string | undefined
  body: unknown
}

const headerOf = (
  headers: RequestInit['headers'],
  name: string,
): string | undefined => {
  if (headers === undefined) return undefined
  return new Headers(headers).get(name) ?? undefined
}

const setup = (response: Response) => {
  const captured: CapturedRequest[] = []
  const fetchImpl: typeof fetch = (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const body = init?.body
    const bodyText = typeof body === 'string' ? body : ''
    captured.push({
      url,
      authorization: headerOf(init?.headers, 'authorization'),
      body: JSON.parse(bodyText) as unknown,
    })
    return Promise.resolve(response)
  }
  const fetchMock = vi.fn(fetchImpl)
  const client = createTavilyWebSearchClient({
    apiKey: 'test-key',
    endpoint: 'https://api.example.test/search',
    fetch: fetchMock,
  })
  return { client, captured }
}

describe('createTavilyWebSearchClient', () => {
  it('normalizes Tavily results to {title, url, text} snippets', async () => {
    const { client, captured } = setup(
      jsonResponse(200, {
        results: [
          {
            title: 'Banana nutrition',
            url: 'https://example.test/banana',
            content: 'A banana has about 89 kcal per 100g.',
            score: 0.91,
          },
          {
            title: 'USDA: Banana',
            url: 'https://example.test/usda-banana',
            content: 'Carbohydrate 22.8g per 100g.',
          },
        ],
      }),
    )

    const result = (
      await client.search('banana nutrition', { limit: 3 })
    )._unsafeUnwrap()

    expect(result).toEqual({
      snippets: [
        {
          title: 'Banana nutrition',
          url: 'https://example.test/banana',
          text: 'A banana has about 89 kcal per 100g.',
        },
        {
          title: 'USDA: Banana',
          url: 'https://example.test/usda-banana',
          text: 'Carbohydrate 22.8g per 100g.',
        },
      ],
    })
    expect(captured[0]).toEqual({
      url: 'https://api.example.test/search',
      authorization: 'Bearer test-key',
      body: {
        query: 'banana nutrition',
        max_results: 3,
      },
    })
  })

  it('throws WebSearchRateLimitError on HTTP 429', async () => {
    const { client } = setup(jsonResponse(429, { error: 'rate limited' }))

    const error = (await client.search('rice'))._unsafeUnwrapErr()
    const status = error instanceof WebSearchError ? error.status : undefined

    expect(error).toBeInstanceOf(WebSearchRateLimitError)
    expect(error).toBeInstanceOf(WebSearchError)
    expect(status).toBe(429)
  })

  it('returns an empty snippet list when the API returns no results', async () => {
    const { client } = setup(jsonResponse(200, { results: [] }))

    expect((await client.search('not-a-real-food'))._unsafeUnwrap()).toEqual({
      snippets: [],
    })
  })

  it('throws WebSearchInvalidResponseError when a result entry violates the schema', async () => {
    const { client } = setup(
      jsonResponse(200, {
        results: [{ title: 'Ok', content: 'snippet' }],
      }),
    )

    const error = (await client.search('missing-url'))._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(WebSearchInvalidResponseError)
    expect(error).toBeInstanceOf(WebSearchError)
  })

  it('wraps non-JSON 2xx bodies in WebSearchError', async () => {
    const response = new Response('<html>oops</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
    const { client } = setup(response)

    const error = (await client.search('q'))._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(WebSearchError)
    expect(error).not.toBeInstanceOf(WebSearchRateLimitError)
    expect(error instanceof WebSearchError ? error.status : undefined).toBe(200)
  })
})
