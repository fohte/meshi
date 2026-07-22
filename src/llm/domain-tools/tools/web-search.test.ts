import { errAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { createTavilyWebSearchClient } from '@/adapters/web-search/tavily-web-search-client'
import type { WebSearchClient } from '@/adapters/web-search/web-search-client'
import {
  WebSearchError,
  WebSearchRateLimitError,
} from '@/adapters/web-search/web-search-client'
import { normalizeResult } from '@/llm/domain-tools/test-helpers'
import { createWebSearchTool } from '@/llm/domain-tools/tools/web-search'

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

interface CapturedRequest {
  url: string
  body: unknown
}

const setupWithTavily = (
  response: Response,
): {
  tool: ReturnType<typeof createWebSearchTool>
  captured: CapturedRequest[]
} => {
  const captured: CapturedRequest[] = []
  const fetchImpl: typeof fetch = (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const bodyText = typeof init?.body === 'string' ? init.body : ''
    captured.push({ url, body: JSON.parse(bodyText) as unknown })
    return Promise.resolve(response)
  }
  const client = createTavilyWebSearchClient({
    apiKey: 'test-key',
    endpoint: 'https://api.example.test/search',
    fetch: vi.fn(fetchImpl),
  })
  return { tool: createWebSearchTool(client), captured }
}

describe('web_search tool', () => {
  it('calls the Tavily HTTP endpoint and returns snippets', async () => {
    const { tool, captured } = setupWithTavily(
      jsonResponse(200, {
        results: [
          {
            title: 'Banana nutrition',
            url: 'https://example.test/banana',
            content: 'A banana has about 89 kcal per 100g.',
          },
        ],
      }),
    )

    const result = await tool.execute({
      query: 'banana nutrition',
      limit: 3,
    })

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: {
        snippets: [
          {
            title: 'Banana nutrition',
            url: 'https://example.test/banana',
            text: 'A banana has about 89 kcal per 100g.',
          },
        ],
      },
    })
    expect(captured).toEqual([
      {
        url: 'https://api.example.test/search',
        body: { query: 'banana nutrition', max_results: 3 },
      },
    ])
  })

  it('rejects empty query with invalid_input and never calls the upstream', async () => {
    const { tool, captured } = setupWithTavily(
      jsonResponse(200, { results: [] }),
    )
    const result = await tool.execute({ query: '' })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 1 } },
      },
    })
    expect(captured).toEqual([])
  })

  it('maps WebSearchRateLimitError to web_search/rate_limited', async () => {
    const client: WebSearchClient = {
      search: () => errAsync(new WebSearchRateLimitError()),
    }
    const tool = createWebSearchTool(client)
    const result = await tool.execute({ query: 'rice' })
    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: { code: 'web_search/rate_limited', message: '<dynamic>' },
    })
  })

  it('maps generic WebSearchError to web_search/failed with status detail', async () => {
    const client: WebSearchClient = {
      search: () => errAsync(new WebSearchError('upstream 500', 500)),
    }
    const tool = createWebSearchTool(client)
    const result = await tool.execute({ query: 'rice' })
    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'web_search/failed',
        message: '<dynamic>',
        details: { status: 500 },
      },
    })
  })
})
