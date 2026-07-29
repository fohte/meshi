import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { ApiRequestError, ApiResponseShapeError } from '#api/errors'
import { fetchJson } from '#api/fetch-json'

const schema = z.object({ value: z.number() })

const mockFetchOk = (body: unknown): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchJson', () => {
  it('resolves with the parsed body on a schema-matching response', async () => {
    mockFetchOk({ value: 42 })

    const result = await fetchJson('/api/thing', schema)

    expect(result._unsafeUnwrap()).toEqual({ value: 42 })
  })

  it('fails with ApiRequestError when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      }),
    )

    const result = await fetchJson('/api/thing', schema)

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ApiRequestError)
  })

  it('fails with ApiRequestError when the fetch itself rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const result = await fetchJson('/api/thing', schema)

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ApiRequestError)
  })

  it('fails with ApiResponseShapeError when the body does not match the schema', async () => {
    mockFetchOk({ value: 'not a number' })

    const result = await fetchJson('/api/thing', schema)

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ApiResponseShapeError)
  })
})
