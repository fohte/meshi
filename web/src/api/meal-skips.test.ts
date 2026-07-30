import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '#api/errors'
import { deleteMealSkip, putMealSkip } from '#api/meal-skips'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('putMealSkip', () => {
  it('resolves with undefined on a 200 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const result = await putMealSkip('2026-07-29', 'lunch')

    expect(fetchMock).toHaveBeenCalledWith('/api/meal-skips/2026-07-29/lunch', {
      method: 'PUT',
    })
    expect(result.isOk()).toBe(true)
  })

  it('fails with an ApiRequestError on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 400 }),
    )

    const result = await putMealSkip('2026-07-29', 'lunch')

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ApiRequestError)
  })
})

describe('deleteMealSkip', () => {
  it('resolves with undefined on a 204 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)

    const result = await deleteMealSkip('2026-07-29', 'lunch')

    expect(fetchMock).toHaveBeenCalledWith('/api/meal-skips/2026-07-29/lunch', {
      method: 'DELETE',
    })
    expect(result.isOk()).toBe(true)
  })

  it('fails with an ApiRequestError on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    )

    const result = await deleteMealSkip('2026-07-29', 'lunch')

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ApiRequestError)
  })
})
