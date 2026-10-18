import { errAsync, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'

const schema = z.object({ name: z.string() })
const apiErrorSchema = z.object({ error: z.string() })

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })

// Reduces a Result to a plain, comparable shape for a single toEqual
// assertion instead of asserting on isOk/isErr and the payload separately.
const outcomeOf = (
  result: Awaited<ReturnType<typeof requestJson>>,
): { ok: true; value: unknown } | { ok: false; message: string } =>
  result.match(
    (value: unknown) => ({ ok: true, value }),
    (error: Error) => ({ ok: false, message: error.message }),
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestJson', () => {
  it('resolves with the parsed body on a matching 2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ name: 'ramen' })),
    )

    const result = await requestJson('/api/thing', schema)

    expect(outcomeOf(result)).toEqual({ ok: true, value: { name: 'ramen' } })
  })

  it('fails when fetch itself rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const result = await requestJson('/api/thing', schema)

    expect(outcomeOf(result)).toEqual({
      ok: false,
      message: 'request to /api/thing failed',
    })
  })

  it('fails when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    )

    const result = await requestJson('/api/thing', schema)

    expect(outcomeOf(result)).toEqual({
      ok: false,
      message: '/api/thing responded with 500',
    })
  })

  it('uses an asynchronous HTTP error mapper', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: 'A conflict occurred' }, { status: 409 }),
        ),
    )

    const result = await requestJson('/api/thing', schema, undefined, (res) =>
      ResultAsync.fromPromise(
        res.json() as Promise<unknown>,
        (cause) => new ApiRequestError('failed to parse error response', cause),
      ).andThen((body) => {
        const parsed = apiErrorSchema.safeParse(body)
        return parsed.success
          ? errAsync(new ApiRequestError(parsed.data.error, undefined))
          : errAsync(new ApiRequestError('invalid error body', parsed.error))
      }),
    )

    expect(outcomeOf(result)).toEqual({
      ok: false,
      message: 'A conflict occurred',
    })
  })

  it('fails when the body does not match the schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ name: 42 })),
    )

    const result = await requestJson('/api/thing', schema)

    expect(outcomeOf(result)).toEqual({
      ok: false,
      message: '/api/thing response did not match the expected schema',
    })
  })
})
