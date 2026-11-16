import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchWeightOutlook } from '#api/weight-outlook'

const outlook = {
  asOf: '2093-04-12',
  points: [{ date: '2093-04-12', weightKg: 63.4 }],
  latestWeightKg: 63.4,
  goalWeightKg: 60,
  trend: {
    slopeKgPerDay: -0.02,
    slopeKgPerWeek: -0.14,
    points: [
      {
        date: '2093-04-12',
        weightKg: 63.4,
        lowerKg: 63.1,
        upperKg: 63.7,
      },
    ],
  },
  status: 'arrival_estimate',
  reason: null,
  arrivalDateRange: { from: '2093-05-01', to: '2093-05-12' },
}

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const apiOutput = (result: unknown, request: unknown) => ({ result, request })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('weight outlook API client', () => {
  it('requests the outlook and validates the response', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(jsonResponse(outlook))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchWeightOutlook()

    expect(
      apiOutput(
        result.isOk() ? result.value : result.error.message,
        fetchMock.mock.calls[0]?.[0],
      ),
    ).toEqual({ result: outlook, request: '/api/weight-outlook' })
  })

  it('rejects a response with an unknown status', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(
      jsonResponse({ ...outlook, status: 'future_status' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchWeightOutlook()

    expect(result.isErr() ? result.error.message : 'unexpected success').toBe(
      '/api/weight-outlook response did not match the expected schema',
    )
  })
})
