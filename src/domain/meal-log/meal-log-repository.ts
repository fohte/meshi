import type { ResultAsync } from 'neverthrow'

import type { DomainError } from '#domain/meal-log/errors'
import type {
  FoodMasterRef,
  MealLogRow,
  MealType,
} from '#domain/meal-log/types'
import type { JstDate } from '#lib/jst-date'

export interface InsertMealLogInput {
  readonly id: string
  readonly foodMasterId: string
  readonly eatenDate: JstDate
  readonly mealType: MealType
  readonly quantity: number
  readonly unit: string
  readonly amountGrams: number
}

// Distinct from the service-facing UpdateMealLogInput (types.ts): the
// service resolves quantity/unit (+ a possibly-changed food_master_id) to
// amountGrams before reaching the repository, so this patch carries that
// resolved value alongside whichever display fields changed — mirroring the
// InsertMealLogInput vs RecordMealLogInput split above.
export interface UpdateMealLogPatch {
  readonly id: string
  readonly foodMasterId?: string
  readonly eatenDate?: JstDate
  readonly mealType?: MealType
  readonly quantity?: number
  readonly unit?: string
  readonly amountGrams?: number
}

export interface FoundMealLog {
  readonly log: MealLogRow
  readonly food: FoodMasterRef
}

export interface MealLogRepository {
  findFoodMaster(foodMasterId: string): ResultAsync<FoodMasterRef, DomainError>
  insertMealLog(input: InsertMealLogInput): ResultAsync<MealLogRow, DomainError>
  updateMealLog(input: UpdateMealLogPatch): ResultAsync<MealLogRow, DomainError>
  findMealLogById(id: string): ResultAsync<FoundMealLog | null, DomainError>
  // Resolves to false when no row matched `id`, rather than an error — the
  // service layer decides whether a no-op delete is a MealLogNotFoundError.
  deleteMealLog(id: string): ResultAsync<boolean, DomainError>
}
