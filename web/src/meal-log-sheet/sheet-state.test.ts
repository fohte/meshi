import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DayDetailEntry } from '#api/day-detail'
import {
  applyFoodSelection,
  backToSearch,
  buildContinueState,
  buildCreateState,
  buildEditState,
  buildSavePayload,
  previewKcal,
  type SelectedFood,
  type SheetState,
} from '#meal-log-sheet/sheet-state'

const RICE: SelectedFood = {
  foodMasterId: 'fm_1',
  name: '白米',
  isEstimated: false,
  energyKcalPerUnit: 168,
}

const ENTRY: DayDetailEntry = {
  id: 'ml_1',
  foodMasterId: 'fm_rice',
  foodName: '白米',
  eatenDate: '2026-07-29',
  mealType: 'breakfast',
  quantity: 150,
  kcal: 234,
  isEstimated: false,
}

describe('buildCreateState', () => {
  beforeEach(() => {
    // vi.setSystemTime only fakes Date; Temporal.Now reads the system clock
    // directly, so it has to be stubbed on its own. The instant is one whose
    // calendar date differs outside JST, so a missing/wrong time zone
    // argument fails here rather than passing by coincidence.
    vi.spyOn(Temporal.Now, 'plainDateISO').mockImplementation((timeZone) =>
      Temporal.Instant.from('2026-07-28T15:30:00Z')
        .toZonedDateTimeISO(timeZone ?? 'UTC')
        .toPlainDate(),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to a create/search state seeded with today (JST)', () => {
    expect(buildCreateState()).toEqual({
      mode: 'create',
      mealLogId: null,
      phase: 'search',
      query: '',
      selectedFood: null,
      isNewFood: false,
      quantity: '1',
      mealType: null,
      date: '2026-07-29',
      justSaved: false,
    })
  })
})

describe('buildContinueState', () => {
  it('resets to search but keeps date and marks justSaved', () => {
    const previous: SheetState = {
      ...buildCreateState(),
      date: '2026-07-20',
      selectedFood: RICE,
      quantity: '200',
    }

    expect(buildContinueState(previous)).toEqual({
      mode: 'create',
      mealLogId: null,
      phase: 'search',
      query: '',
      selectedFood: null,
      isNewFood: false,
      quantity: '1',
      mealType: null,
      date: '2026-07-20',
      justSaved: true,
    })
  })
})

describe('buildEditState', () => {
  it('seeds the form from a DayDetailEntry', () => {
    expect(buildEditState(ENTRY)).toEqual({
      mode: 'edit',
      mealLogId: 'ml_1',
      phase: 'detail',
      query: '',
      selectedFood: {
        foodMasterId: 'fm_rice',
        name: '白米',
        isEstimated: false,
        energyKcalPerUnit: null,
      },
      isNewFood: false,
      quantity: '150',
      mealType: 'breakfast',
      date: '2026-07-29',
      justSaved: false,
    })
  })
})

describe('previewKcal', () => {
  const withRice = { ...buildCreateState(), selectedFood: RICE }

  it('multiplies energyKcalPerUnit by quantity', () => {
    expect(previewKcal({ ...withRice, quantity: '2' })).toBe(336)
  })

  it('returns null when no food is selected', () => {
    expect(previewKcal(buildCreateState())).toBeNull()
  })

  it('returns null for a non-numeric quantity', () => {
    expect(previewKcal({ ...withRice, quantity: 'abc' })).toBeNull()
  })

  it('returns null when energyKcalPerUnit is unknown (edit mode)', () => {
    expect(
      previewKcal({
        ...withRice,
        selectedFood: { ...RICE, energyKcalPerUnit: null },
      }),
    ).toBeNull()
  })
})

describe('applyFoodSelection', () => {
  it('moves to the detail phase and keeps quantity for an existing food', () => {
    const state = { ...buildCreateState(), quantity: '2' }

    expect(applyFoodSelection(state, RICE, false)).toEqual({
      ...state,
      selectedFood: RICE,
      isNewFood: false,
      phase: 'detail',
      quantity: '2',
    })
  })

  it('resets quantity to 100 for a newly-registered composition food', () => {
    const state = { ...buildCreateState(), quantity: '2' }

    expect(applyFoodSelection(state, RICE, true)).toEqual({
      ...state,
      selectedFood: RICE,
      isNewFood: true,
      phase: 'detail',
      quantity: '100',
    })
  })
})

describe('backToSearch', () => {
  it('clears the selected food and returns to the search phase', () => {
    const state: SheetState = {
      ...buildCreateState(),
      selectedFood: RICE,
      isNewFood: true,
      phase: 'detail',
    }

    expect(backToSearch(state)).toEqual({
      ...state,
      phase: 'search',
      selectedFood: null,
      isNewFood: false,
    })
  })
})

describe('buildSavePayload', () => {
  it('returns null when no food is selected', () => {
    expect(buildSavePayload(buildCreateState())).toBeNull()
  })

  it('returns null when date is empty', () => {
    expect(
      buildSavePayload({ ...buildCreateState(), selectedFood: RICE, date: '' }),
    ).toBeNull()
  })

  it('returns null when mealType is not chosen', () => {
    expect(
      buildSavePayload({
        ...buildCreateState(),
        selectedFood: RICE,
        mealType: null,
      }),
    ).toBeNull()
  })

  it.each(['0', '-1', 'abc', ''])(
    'returns null for a non-positive/non-numeric quantity %p',
    (quantity) => {
      expect(
        buildSavePayload({
          ...buildCreateState(),
          selectedFood: RICE,
          mealType: 'breakfast',
          quantity,
        }),
      ).toBeNull()
    },
  )

  it('builds a payload with the chosen mealType', () => {
    const state: SheetState = {
      ...buildCreateState(),
      selectedFood: RICE,
      quantity: '150',
      mealType: 'dinner',
      date: '2026-07-29',
    }

    expect(buildSavePayload(state)).toEqual({
      foodMasterId: 'fm_1',
      eatenDate: '2026-07-29',
      mealType: 'dinner',
      quantity: 150,
    })
  })
})
