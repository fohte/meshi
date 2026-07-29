import type { DayDetailEntry, MealType } from '#api/day-detail'
import type { RecordMealLogInput } from '#api/meal-logs'
import { inferMealType } from '#lib/infer-meal-type'
import {
  formatJstDate,
  formatJstTime,
  jstWallClockToIsoInstant,
  nowJstTime,
  todayJstDate,
} from '#lib/jst-date'

export type SheetPhase = 'search' | 'detail'
export type SheetMode = 'create' | 'edit'

export interface SelectedFood {
  readonly foodMasterId: string
  readonly name: string
  readonly isEstimated: boolean
  // Only known for a food picked from search/suggestions (FoodListItem) or
  // a freshly-registered composition candidate — an edited entry's food
  // isn't re-fetched, so this stays null and the detail form skips the
  // kcal preview rather than showing a stale/wrong number.
  readonly energyKcalPer100g: number | null
}

export interface SheetState {
  readonly mode: SheetMode
  readonly mealLogId: string | null
  readonly phase: SheetPhase
  readonly query: string
  readonly selectedFood: SelectedFood | null
  readonly isNewFood: boolean
  readonly quantity: string
  readonly unit: string
  // null means "infer from time" — set once the user explicitly picks one.
  readonly mealType: MealType | null
  readonly date: string
  readonly time: string
  readonly note: string
  readonly justSaved: boolean
}

export const buildCreateState = (): SheetState => ({
  mode: 'create',
  mealLogId: null,
  phase: 'search',
  query: '',
  selectedFood: null,
  isNewFood: false,
  quantity: '1',
  unit: 'g',
  mealType: null,
  date: todayJstDate(),
  time: nowJstTime(),
  note: '',
  justSaved: false,
})

// Continuing after a save keeps the date/time the user was working with
// (e.g. logging several items from the same meal) instead of resetting to
// "now".
export const buildContinueState = (previous: SheetState): SheetState => ({
  ...buildCreateState(),
  date: previous.date,
  time: previous.time,
  justSaved: true,
})

export const buildEditState = (entry: DayDetailEntry): SheetState => ({
  mode: 'edit',
  mealLogId: entry.id,
  phase: 'detail',
  query: '',
  selectedFood: {
    foodMasterId: entry.foodMasterId,
    name: entry.foodName,
    isEstimated: entry.isEstimated,
    energyKcalPer100g: null,
  },
  isNewFood: false,
  quantity: String(entry.quantity),
  unit: entry.unit,
  mealType: entry.mealType,
  date: formatJstDate(entry.eatenAt),
  time: formatJstTime(entry.eatenAt),
  note: entry.note ?? '',
  justSaved: false,
})

// unit=g/kg/mg always resolves without a per-food unit definition (see
// resolveAmountGrams on the backend); anything else needs a food_master_unit
// this client doesn't have, so the sheet skips the preview rather than
// showing a wrong number.
const GRAM_MULTIPLIERS: Readonly<Record<string, number>> = {
  g: 1,
  kg: 1000,
  mg: 0.001,
}

export const previewKcal = (state: SheetState): number | null => {
  const energyKcalPer100g = state.selectedFood?.energyKcalPer100g ?? null
  if (energyKcalPer100g === null) return null
  const multiplier = GRAM_MULTIPLIERS[state.unit.trim().toLowerCase()]
  if (multiplier === undefined) return null
  const quantity = Number(state.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  const grams = quantity * multiplier
  return (energyKcalPer100g * grams) / 100
}

export const resolvedMealType = (state: SheetState): MealType =>
  state.mealType ?? inferMealType(state.time)

// A newly-registered composition candidate defaults to g/100 (it has no
// food_master_unit yet — see registerFromComposition on the backend), so
// switching to it resets quantity/unit; picking an existing food_master
// keeps whatever the user already typed.
export const applyFoodSelection = (
  state: SheetState,
  food: SelectedFood,
  isNew: boolean,
): SheetState => ({
  ...state,
  selectedFood: food,
  isNewFood: isNew,
  phase: 'detail',
  unit: isNew ? 'g' : state.unit,
  quantity: isNew ? '100' : state.quantity,
})

export const backToSearch = (state: SheetState): SheetState => ({
  ...state,
  phase: 'search',
  selectedFood: null,
  isNewFood: false,
})

// Returns null when the form isn't ready to submit (no food selected, an
// empty date/time — the <input type="date"|"time"> controls allow clearing
// to '', which `new Date(...)` in jstWallClockToIsoInstant would otherwise
// throw a RangeError on — or a non-positive/non-numeric quantity). The sheet
// disables its save button on the same condition, so this doubles as the
// canSave check.
export const buildSavePayload = (
  state: SheetState,
): RecordMealLogInput | null => {
  if (state.selectedFood === null) return null
  if (state.date === '' || state.time === '') return null
  const quantity = Number(state.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  const note = state.note.trim()
  return {
    foodMasterId: state.selectedFood.foodMasterId,
    eatenAt: jstWallClockToIsoInstant(state.date, state.time),
    mealType: resolvedMealType(state),
    quantity,
    unit: state.unit.trim(),
    ...(note === '' ? {} : { note }),
  }
}
