import type { DayDetailEntry, MealType } from '#api/day-detail'
import type {
  RecordBatchMealLogInput,
  RecordMealLogInput,
} from '#api/meal-logs'
import type { MealSet } from '#api/meal-sets'
import { todayJstDate } from '#lib/jst-date'

type SheetPhase = 'search' | 'detail'

export interface SelectedFood {
  readonly foodMasterId: string
  readonly name: string
  readonly isEstimated: boolean
  // Edited entries are not re-fetched, so their kcal preview stays hidden
  // instead of showing a value that may no longer match the food master.
  readonly energyKcalPerUnit: number | null
}

interface SingleSheetStateFields {
  readonly phase: SheetPhase
  readonly query: string
  readonly selectedFood: SelectedFood | null
  readonly isNewFood: boolean
  readonly quantity: string
  // The user must choose a meal type; it is never inferred from the time.
  readonly mealType: MealType | null
  readonly date: string
  readonly justSaved: boolean
}

export interface CreateSheetState extends SingleSheetStateFields {
  readonly mode: 'create'
  readonly mealLogId: null
  readonly activeTab: 'food' | 'meal-set'
}

export interface EditSheetState extends SingleSheetStateFields {
  readonly mode: 'edit'
  readonly mealLogId: string
}

export interface MealSetRecordItem {
  readonly id: number
  readonly foodMasterId: string
  readonly foodName: string
  readonly quantity: string
  readonly energyKcalPerUnit: number | null
}

export type MealSetFoodSelection =
  | { readonly type: 'add' }
  | { readonly type: 'replace'; readonly itemId: number }

export interface MealSetRecordState {
  readonly mode: 'meal-set'
  readonly mealSetName: string
  readonly items: ReadonlyArray<MealSetRecordItem>
  readonly nextItemId: number
  readonly query: string
  readonly pendingSelection: MealSetFoodSelection | null
  readonly mealType: MealType | null
  readonly date: string
}

export type SingleSheetState = CreateSheetState | EditSheetState
export type SheetState = SingleSheetState | MealSetRecordState

export const buildCreateState = (): CreateSheetState => ({
  mode: 'create',
  mealLogId: null,
  phase: 'search',
  query: '',
  selectedFood: null,
  isNewFood: false,
  quantity: '1',
  mealType: null,
  date: todayJstDate(),
  justSaved: false,
  activeTab: 'food',
})

// Continuing after a save keeps the date the user was working with.
export const buildContinueState = (
  previous: CreateSheetState,
): CreateSheetState => ({
  ...buildCreateState(),
  date: previous.date,
  justSaved: true,
})

export const buildEditState = (entry: DayDetailEntry): EditSheetState => ({
  mode: 'edit',
  mealLogId: entry.id,
  phase: 'detail',
  query: '',
  selectedFood: {
    foodMasterId: entry.foodMasterId,
    name: entry.foodName,
    isEstimated: entry.isEstimated,
    energyKcalPerUnit: null,
  },
  isNewFood: false,
  quantity: String(entry.quantity),
  mealType: entry.mealType,
  date: entry.eatenDate,
  justSaved: false,
})

export const previewKcal = (state: SingleSheetState): number | null => {
  const energyKcalPerUnit = state.selectedFood?.energyKcalPerUnit ?? null
  if (energyKcalPerUnit === null) return null
  const quantity = Number(state.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  return energyKcalPerUnit * quantity
}

// New composition foods default to 100 because that is their registered unit.
export const applyFoodSelection = (
  state: CreateSheetState,
  food: SelectedFood,
  isNew: boolean,
): CreateSheetState => ({
  ...state,
  selectedFood: food,
  isNewFood: isNew,
  phase: 'detail',
  quantity: isNew ? '100' : state.quantity,
})

export const backToSearch = (state: CreateSheetState): CreateSheetState => ({
  ...state,
  phase: 'search',
  selectedFood: null,
  isNewFood: false,
})

export const setCreateTab = (
  state: CreateSheetState,
  activeTab: CreateSheetState['activeTab'],
): CreateSheetState => ({ ...state, activeTab })

export const buildMealSetRecordState = (
  mealSet: MealSet,
  date: string,
): MealSetRecordState => ({
  mode: 'meal-set',
  mealSetName: mealSet.name,
  items: mealSet.items.map((item, index) => ({
    id: index,
    foodMasterId: item.foodMasterId,
    foodName: item.foodName,
    quantity: String(item.quantity),
    energyKcalPerUnit: item.energyKcalPerUnit,
  })),
  nextItemId: mealSet.items.length,
  query: '',
  pendingSelection: null,
  mealType: null,
  date,
})

export const beginMealSetFoodSelection = (
  state: MealSetRecordState,
  selection: MealSetFoodSelection,
): MealSetRecordState => ({ ...state, pendingSelection: selection, query: '' })

export const cancelMealSetFoodSelection = (
  state: MealSetRecordState,
): MealSetRecordState => ({ ...state, pendingSelection: null, query: '' })

export const applyMealSetFoodSelection = (
  state: MealSetRecordState,
  food: SelectedFood,
): MealSetRecordState => {
  const pendingSelection = state.pendingSelection
  if (pendingSelection === null) return state

  if (pendingSelection.type === 'replace') {
    return {
      ...state,
      pendingSelection: null,
      query: '',
      items: state.items.map((item) =>
        item.id === pendingSelection.itemId
          ? {
              ...item,
              foodMasterId: food.foodMasterId,
              foodName: food.name,
              energyKcalPerUnit: food.energyKcalPerUnit,
            }
          : item,
      ),
    }
  }

  return {
    ...state,
    pendingSelection: null,
    query: '',
    nextItemId: state.nextItemId + 1,
    items: [
      ...state.items,
      {
        id: state.nextItemId,
        foodMasterId: food.foodMasterId,
        foodName: food.name,
        quantity: '1',
        energyKcalPerUnit: food.energyKcalPerUnit,
      },
    ],
  }
}

export const setMealSetItemQuantity = (
  state: MealSetRecordState,
  itemId: number,
  quantity: string,
): MealSetRecordState => ({
  ...state,
  items: state.items.map((item) =>
    item.id === itemId ? { ...item, quantity } : item,
  ),
})

export const removeMealSetItem = (
  state: MealSetRecordState,
  itemId: number,
): MealSetRecordState => ({
  ...state,
  items: state.items.filter((item) => item.id !== itemId),
})

// A cleared date, missing selection, missing meal type, or invalid quantity
// leaves the form disabled until the user supplies a valid value.
export const buildSavePayload = (
  state: SingleSheetState,
): RecordMealLogInput | null => {
  if (state.selectedFood === null) return null
  if (state.date === '') return null
  if (state.mealType === null) return null
  const quantity = Number(state.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  return {
    foodMasterId: state.selectedFood.foodMasterId,
    eatenDate: state.date,
    mealType: state.mealType,
    quantity,
  }
}

export const buildMealSetSavePayload = (
  state: MealSetRecordState,
): RecordBatchMealLogInput | null => {
  if (state.pendingSelection !== null) return null
  if (
    state.items.length === 0 ||
    state.date === '' ||
    state.mealType === null
  ) {
    return null
  }

  const items = state.items.map((item) => ({
    foodMasterId: item.foodMasterId,
    quantity: Number(item.quantity),
  }))
  if (
    items.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0)
  ) {
    return null
  }

  return { eatenDate: state.date, mealType: state.mealType, items }
}
