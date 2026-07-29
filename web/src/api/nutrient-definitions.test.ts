import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchNutrientDefinitions } from '#api/nutrient-definitions'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchNutrientDefinitions', () => {
  it('resolves with the parsed list', async () => {
    const definition = {
      code: 'energy_kcal',
      displayName: 'エネルギー',
      unit: 'kcal',
      isMajor: true,
      sortOrder: 1,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([definition]),
      }),
    )

    const result = await fetchNutrientDefinitions()

    expect(result._unsafeUnwrap()).toEqual([definition])
  })
})
