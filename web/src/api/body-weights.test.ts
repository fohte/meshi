import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  deleteBodyWeight,
  fetchBodyWeights,
  patchBodyWeight,
  postBodyWeight,
} from '#api/body-weights'

const row = {
  id: 'weight_demo_one',
  date: '2026-07-04',
  measuredAt: '2026-07-04T00:30:00.000Z',
  weightKg: 63.45,
  createdAt: '2026-07-04T00:30:00.000Z',
  updatedAt: '2026-07-04T00:30:00.000Z',
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const apiOutput = (result: unknown, request: unknown) => ({ result, request })

const apiErrorOutput = (message: string, request: unknown) => ({
  message,
  request,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('body-weight API client', () => {
  it('requests an inclusive date range and validates its response', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(jsonResponse([row]))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchBodyWeights('2026-07-01', '2026-07-07')

    expect(
      apiOutput(
        result.isOk() ? result.value : result.error.message,
        fetchMock.mock.calls[0]?.[0],
      ),
    ).toEqual({
      result: [row],
      request: '/api/body-weights?from=2026-07-01&to=2026-07-07',
    })
  })

  it('posts new measurements as JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(jsonResponse(row, 201))
    vi.stubGlobal('fetch', fetchMock)

    const result = await postBodyWeight({
      date: '2026-07-04',
      weightKg: 63.45,
      measuredAt: '2026-07-04T09:30:00+09:00',
    })

    expect(
      apiOutput(
        result.isOk() ? result.value : result.error.message,
        fetchMock.mock.calls[0],
      ),
    ).toEqual({
      result: row,
      request: [
        '/api/body-weights',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            date: '2026-07-04',
            weightKg: 63.45,
            measuredAt: '2026-07-04T09:30:00+09:00',
          }),
        },
      ],
    })
  })

  it('patches measurements and preserves server validation errors', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'weightKg must be between 20 and 300 kg' }, 400),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await patchBodyWeight('weight_demo_one', {
      date: '2026-07-04',
      weightKg: 12,
      measuredAt: null,
    })

    expect(
      apiErrorOutput(
        result.isErr() ? result.error.message : 'unexpected success',
        fetchMock.mock.calls[0],
      ),
    ).toEqual({
      message: 'weightKg must be between 20 and 300 kg',
      request: [
        '/api/body-weights/weight_demo_one',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            date: '2026-07-04',
            weightKg: 12,
            measuredAt: null,
          }),
        },
      ],
    })
  })

  it('deletes a measurement without parsing a response body', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await deleteBodyWeight('weight_demo_one')

    expect(
      apiOutput(
        result.isOk() ? 'ok' : result.error.message,
        fetchMock.mock.calls[0],
      ),
    ).toEqual({
      result: 'ok',
      request: ['/api/body-weights/weight_demo_one', { method: 'DELETE' }],
    })
  })
})
