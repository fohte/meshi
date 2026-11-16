import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  deleteBodyComposition,
  fetchBodyCompositions,
  patchBodyComposition,
  postBodyComposition,
} from '#api/body-compositions'

const row = {
  id: 'composition_demo_one',
  date: '2031-04-12',
  measuredAt: '2031-04-12T00:20:00.000Z',
  device: 'Example Scale Z',
  bodyFatPercent: 24.5,
  muscleMassKg: null,
  skeletalMusclePercent: 31.2,
  createdAt: '2031-04-12T00:20:00.000Z',
  updatedAt: '2031-04-12T00:20:00.000Z',
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

describe('body-composition API client', () => {
  it('requests an inclusive date range and validates nullable values', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(jsonResponse([row]))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchBodyCompositions('2031-04-06', '2031-04-12')

    expect(
      apiOutput(
        result.isOk() ? result.value : result.error.message,
        fetchMock.mock.calls[0]?.[0],
      ),
    ).toEqual({
      result: [row],
      request: '/api/body-compositions?from=2031-04-06&to=2031-04-12',
    })
  })

  it('posts a partial measurement as JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(jsonResponse(row, 201))
    vi.stubGlobal('fetch', fetchMock)

    const result = await postBodyComposition({
      date: '2031-04-12',
      device: 'Example Scale Z',
      bodyFatPercent: 24.5,
      skeletalMusclePercent: 31.2,
    })

    expect(
      apiOutput(
        result.isOk() ? result.value : result.error.message,
        fetchMock.mock.calls[0],
      ),
    ).toEqual({
      result: row,
      request: [
        '/api/body-compositions',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            date: '2031-04-12',
            device: 'Example Scale Z',
            bodyFatPercent: 24.5,
            skeletalMusclePercent: 31.2,
          }),
        },
      ],
    })
  })

  it('patches nullable fields and returns the server validation error', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'body_composition/no_values' }, 400),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await patchBodyComposition('composition_demo_one', {
      muscleMassKg: null,
    })

    expect(
      apiErrorOutput(
        result.isErr() ? result.error.message : 'unexpected success',
        fetchMock.mock.calls[0],
      ),
    ).toEqual({
      message: 'body_composition/no_values',
      request: [
        '/api/body-compositions/composition_demo_one',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ muscleMassKg: null }),
        },
      ],
    })
  })

  it('deletes a measurement without parsing a response body', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await deleteBodyComposition('composition_demo_one')

    expect(
      apiOutput(
        result.isOk() ? 'ok' : result.error.message,
        fetchMock.mock.calls[0],
      ),
    ).toEqual({
      result: 'ok',
      request: [
        '/api/body-compositions/composition_demo_one',
        { method: 'DELETE' },
      ],
    })
  })
})
