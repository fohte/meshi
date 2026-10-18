import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '#api/errors'
import {
  deleteMealSet,
  fetchMealSets,
  patchMealSet,
  postMealSet,
} from '#api/meal-sets'

const SAMPLE_SET = {
  id: 'set_example_01',
  name: 'Example meal',
  items: [
    {
      foodMasterId: 'food_example_01',
      foodName: 'Example food',
      quantity: 1.5,
      energyKcalPerUnit: 123,
    },
    {
      foodMasterId: 'food_example_02',
      foodName: 'Another food',
      quantity: 1,
      energyKcalPerUnit: null,
    },
  ],
  createdAt: '2026-08-19T03:30:00.000Z',
}

const mockFetchOk = (body: unknown, status = 200): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status,
    json: () => Promise.resolve(body),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const normalizedApiError = (error: ApiRequestError) => ({
  name: error.name,
  message: error.message,
  status:
    'status' in error && typeof error.status === 'number' ? error.status : null,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchMealSets', () => {
  it('returns the validated meal sets', async () => {
    mockFetchOk([SAMPLE_SET])

    const result = await fetchMealSets()

    expect(result._unsafeUnwrap()).toEqual([SAMPLE_SET])
  })

  it('requests the meal set list', async () => {
    const fetchMock = mockFetchOk([])

    await fetchMealSets()

    expect(fetchMock.mock.calls).toEqual([['/api/meal-sets', undefined]])
  })
})

describe('postMealSet', () => {
  it('posts the input as JSON', async () => {
    const fetchMock = mockFetchOk(SAMPLE_SET, 201)
    const input = {
      name: 'Example meal',
      items: [
        { foodMasterId: 'food_example_01', quantity: 1.5 },
        { foodMasterId: 'food_example_02', quantity: 1 },
      ],
    }

    await postMealSet(input)

    expect(fetchMock.mock.calls).toEqual([
      [
        '/api/meal-sets',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
      ],
    ])
  })

  it('returns the validated meal set', async () => {
    mockFetchOk(SAMPLE_SET, 201)

    const result = await postMealSet({
      name: 'Example meal',
      items: [{ foodMasterId: 'food_example_01', quantity: 1 }],
    })

    expect(result._unsafeUnwrap()).toEqual(SAMPLE_SET)
  })

  it('returns the API error message and status for a conflicting name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: () =>
          Promise.resolve({
            error: 'A meal set with this name already exists',
          }),
      }),
    )

    const result = await postMealSet({
      name: 'Example meal',
      items: [{ foodMasterId: 'food_example_01', quantity: 1 }],
    })

    expect(normalizedApiError(result._unsafeUnwrapErr())).toEqual({
      name: 'MealSetApiError',
      message: 'A meal set with this name already exists',
      status: 409,
    })
  })
})

describe('patchMealSet', () => {
  it('encodes the set ID and patches with the input', async () => {
    const fetchMock = mockFetchOk(SAMPLE_SET)
    const input = {
      name: 'Example meal',
      items: [{ foodMasterId: 'food_example_01', quantity: 2 }],
    }

    await patchMealSet('set/example', input)

    expect(fetchMock.mock.calls).toEqual([
      [
        '/api/meal-sets/set%2Fexample',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
      ],
    ])
  })

  it('returns the validated meal set', async () => {
    mockFetchOk(SAMPLE_SET)

    const result = await patchMealSet('set_example_01', {
      name: 'Example meal',
      items: [{ foodMasterId: 'food_example_01', quantity: 2 }],
    })

    expect(result._unsafeUnwrap()).toEqual(SAMPLE_SET)
  })
})

describe('deleteMealSet', () => {
  it('requests deletion by encoded set ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)

    await deleteMealSet('set/example')

    expect(fetchMock.mock.calls).toEqual([
      ['/api/meal-sets/set%2Fexample', { method: 'DELETE' }],
    ])
  })

  it('succeeds without parsing a body on a 204 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }))

    const result = await deleteMealSet('set_example_01')

    expect(result.isOk()).toEqual(true)
  })
})

describe('meal set response validation', () => {
  it('returns an ApiRequestError for a response outside the schema', async () => {
    mockFetchOk([
      {
        ...SAMPLE_SET,
        items: [{ ...SAMPLE_SET.items[0], energyKcalPerUnit: 'not a number' }],
      },
    ])

    const result = await fetchMealSets()

    expect(normalizedApiError(result._unsafeUnwrapErr())).toEqual({
      name: 'ApiRequestError',
      message: '/api/meal-sets response did not match the expected schema',
      status: null,
    })
  })
})
