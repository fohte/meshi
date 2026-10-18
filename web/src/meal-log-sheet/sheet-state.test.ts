import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DayDetailEntry } from '#api/day-detail'
import type { MealSet } from '#api/meal-sets'
import {
  applySelectedFoodToSheet,
  backToFoodSearch,
  beginMealSetFoodSelection,
  buildContinueState,
  buildCreateState,
  buildEditState,
  buildMealSetRecordState,
  buildMealSetSavePayload,
  buildSavePayload,
  type CreateSheetState,
  previewKcal,
  removeMealSetItem,
  type SelectedFood,
  setMealSetItemQuantity,
  type SingleSheetState,
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
  nutritionStatus: 'confirmed',
}

const MEAL_SET: MealSet = {
  id: 'ms_demo_alpha',
  name: '作業用セット',
  items: [
    {
      foodMasterId: 'fm_demo_alpha',
      foodName: '架空食品 A',
      quantity: 1.5,
      energyKcalPerUnit: 120,
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
}

const ALTERNATE_FOOD: SelectedFood = {
  foodMasterId: 'fm_demo_beta',
  name: '架空食品 B',
  isEstimated: false,
  energyKcalPerUnit: 80,
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
      activeTab: 'food',
    })
  })
})

describe('buildContinueState', () => {
  it('resets to search but keeps date and marks justSaved', () => {
    const previous: CreateSheetState = {
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
      activeTab: 'food',
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

    expect(applySelectedFoodToSheet(state, RICE, false)).toEqual({
      ...state,
      selectedFood: RICE,
      isNewFood: false,
      phase: 'detail',
      quantity: '2',
    })
  })

  it('resets quantity to 100 for a newly-registered composition food', () => {
    const state = { ...buildCreateState(), quantity: '2' }

    expect(applySelectedFoodToSheet(state, RICE, true)).toEqual({
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
    const state: CreateSheetState = {
      ...buildCreateState(),
      selectedFood: RICE,
      isNewFood: true,
      phase: 'detail',
    }

    expect(backToFoodSearch(state)).toEqual({
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
    const state: SingleSheetState = {
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

describe('buildMealSetRecordState', () => {
  it('copies set items into an editable recording state', () => {
    expect(buildMealSetRecordState(MEAL_SET, '2026-01-02')).toEqual({
      mode: 'meal-set',
      mealSetName: '作業用セット',
      items: [
        {
          id: 0,
          foodMasterId: 'fm_demo_alpha',
          foodName: '架空食品 A',
          quantity: '1.5',
          energyKcalPerUnit: 120,
        },
      ],
      nextItemId: 1,
      query: '',
      pendingSelection: null,
      mealType: null,
      date: '2026-01-02',
    })
  })
})

describe('applyMealSetFoodSelection', () => {
  it('replaces only the selected item and keeps its quantity', () => {
    const state = beginMealSetFoodSelection(
      buildMealSetRecordState(MEAL_SET, '2026-01-02'),
      { type: 'replace', itemId: 0 },
    )

    expect(applySelectedFoodToSheet(state, ALTERNATE_FOOD, false)).toEqual({
      ...state,
      pendingSelection: null,
      query: '',
      items: [
        {
          id: 0,
          foodMasterId: 'fm_demo_beta',
          foodName: '架空食品 B',
          quantity: '1.5',
          energyKcalPerUnit: 80,
        },
      ],
    })
  })

  it('adds the selected food with its default quantity', () => {
    const state = beginMealSetFoodSelection(
      buildMealSetRecordState(MEAL_SET, '2026-01-02'),
      { type: 'add' },
    )

    expect(applySelectedFoodToSheet(state, ALTERNATE_FOOD, false)).toEqual({
      ...state,
      pendingSelection: null,
      query: '',
      nextItemId: 2,
      items: [
        {
          id: 0,
          foodMasterId: 'fm_demo_alpha',
          foodName: '架空食品 A',
          quantity: '1.5',
          energyKcalPerUnit: 120,
        },
        {
          id: 1,
          foodMasterId: 'fm_demo_beta',
          foodName: '架空食品 B',
          quantity: '1',
          energyKcalPerUnit: 80,
        },
      ],
    })
  })
})

describe('meal set item editing', () => {
  it('updates one item quantity', () => {
    const initial = buildMealSetRecordState(MEAL_SET, '2026-01-02')
    expect(setMealSetItemQuantity(initial, 0, '2.25')).toEqual({
      ...initial,
      items: [
        {
          id: 0,
          foodMasterId: 'fm_demo_alpha',
          foodName: '架空食品 A',
          quantity: '2.25',
          energyKcalPerUnit: 120,
        },
      ],
    })
  })

  it('removes one item', () => {
    const initial = buildMealSetRecordState(MEAL_SET, '2026-01-02')

    expect(removeMealSetItem(initial, 0)).toEqual({
      ...initial,
      items: [],
    })
  })
})

describe('backToFoodSearch', () => {
  it('cancels meal set food selection and preserves existing items', () => {
    const initial = buildMealSetRecordState(MEAL_SET, '2026-01-02')
    const selecting = {
      ...beginMealSetFoodSelection(initial, { type: 'replace', itemId: 0 }),
      query: '架空食品',
    }
    const expected = {
      ...selecting,
      pendingSelection: null,
      query: '',
      items: initial.items,
    }

    expect(backToFoodSearch(selecting)).toEqual(expected)
  })
})

describe('buildMealSetSavePayload', () => {
  it('builds a batch payload with the selected meal type and edited quantities', () => {
    const initial = buildMealSetRecordState(MEAL_SET, '2026-01-02')
    const withAddedFood = applySelectedFoodToSheet(
      beginMealSetFoodSelection(initial, { type: 'add' }),
      ALTERNATE_FOOD,
      false,
    )
    const state = {
      ...withAddedFood,
      items: withAddedFood.items.map((item) =>
        item.id === 1 ? { ...item, quantity: '2.25' } : item,
      ),
      mealType: 'dinner' as const,
    }

    expect(buildMealSetSavePayload(state)).toEqual({
      eatenDate: '2026-01-02',
      mealType: 'dinner',
      items: [
        { foodMasterId: 'fm_demo_alpha', quantity: 1.5 },
        { foodMasterId: 'fm_demo_beta', quantity: 2.25 },
      ],
    })
  })

  it('does not build a batch payload when any item quantity is invalid', () => {
    const state = {
      ...buildMealSetRecordState(MEAL_SET, '2026-01-02'),
      mealType: 'dinner' as const,
      items: [
        {
          id: 0,
          foodMasterId: 'fm_demo_alpha',
          foodName: '架空食品 A',
          quantity: '0',
          energyKcalPerUnit: 120,
        },
      ],
    }

    expect(buildMealSetSavePayload(state)).toBeNull()
  })

  it('does not build a batch payload when every item has been removed', () => {
    const state = {
      ...buildMealSetRecordState(MEAL_SET, '2026-01-02'),
      mealType: 'dinner' as const,
      items: [],
    }

    expect(buildMealSetSavePayload(state)).toBeNull()
  })

  it('does not build a batch payload while a food is being selected', () => {
    const state = beginMealSetFoodSelection(
      buildMealSetRecordState(MEAL_SET, '2026-01-02'),
      { type: 'add' },
    )

    expect(buildMealSetSavePayload({ ...state, mealType: 'dinner' })).toBeNull()
  })
})
