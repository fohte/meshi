import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '#api/errors'
import {
  fetchMealPlans,
  type MealPlan,
  postMealPlanCancel,
  putMealPlan,
} from '#api/meal-plans'

const PLAN: MealPlan = {
  id: 'plan_fixture_001',
  date: '2026-08-18',
  mealType: 'dinner',
  reason: '作業後に食べる予定',
  status: 'planned',
  items: [
    {
      foodMasterId: 'fixture_food_a',
      foodName: '架空食品 A',
      quantity: 1.5,
      energyKcalPerUnit: 125,
    },
  ],
}

const requestResultOutput = (
  calls: ReadonlyArray<unknown>,
  value: unknown,
) => ({
  calls,
  value,
})

const normalizedApiError = (error: ApiRequestError) => ({
  name: error.name,
  message: error.message,
})

const cancellationOutput = (
  calls: ReadonlyArray<unknown>,
  succeeded: boolean,
) => ({ calls, succeeded })

const cancellationErrorOutput = (
  calls: ReadonlyArray<unknown>,
  error: unknown,
) => ({ calls, error })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchMealPlans', () => {
  it('requests and validates the half-open date range', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([PLAN]),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMealPlans('2026-08-18', '2026-08-19')

    expect(
      requestResultOutput(fetchMock.mock.calls, result._unsafeUnwrap()),
    ).toEqual({
      calls: [['/api/meal-plans?from=2026-08-18&to=2026-08-19', undefined]],
      value: [PLAN],
    })
  })

  it('rejects statuses outside the supported wire schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ ...PLAN, status: 'unknown' }]),
      }),
    )

    const result = await fetchMealPlans('2026-08-18', '2026-08-19')
    const error = result._unsafeUnwrapErr()

    expect(normalizedApiError(error)).toEqual({
      name: 'ApiRequestError',
      message:
        '/api/meal-plans?from=2026-08-18&to=2026-08-19 response did not match the expected schema',
    })
  })
})

describe('putMealPlan', () => {
  it('saves the selected slot and returns its validated plan', async () => {
    const input = {
      reason: '作業後に食べる予定',
      items: [
        {
          foodMasterId: 'fixture_food_a',
          foodName: '架空食品 A',
          quantity: 1.5,
        },
      ],
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(PLAN),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await putMealPlan('2026-08-18', 'dinner', input)

    expect(
      requestResultOutput(fetchMock.mock.calls, result._unsafeUnwrap()),
    ).toEqual({
      calls: [
        [
          '/api/meal-plans/2026-08-18/dinner',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
          },
        ],
      ],
      value: PLAN,
    })
  })
})

describe('postMealPlanCancel', () => {
  it('posts cancellation to the selected plan', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)

    const result = await postMealPlanCancel('plan/fixture')
    expect(cancellationOutput(fetchMock.mock.calls, result.isOk())).toEqual({
      calls: [['/api/meal-plans/plan%2Ffixture/cancel', { method: 'POST' }]],
      succeeded: true,
    })
  })

  it('returns the server error message when cancellation fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: 'plan cannot be cancelled' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await postMealPlanCancel('plan_fixture')
    const error = result._unsafeUnwrapErr()

    expect(
      cancellationErrorOutput(fetchMock.mock.calls, normalizedApiError(error)),
    ).toEqual({
      calls: [['/api/meal-plans/plan_fixture/cancel', { method: 'POST' }]],
      error: { name: 'ApiRequestError', message: 'plan cannot be cancelled' },
    })
  })
})
