import type { ResultAsync } from 'neverthrow'

import type { DomainError } from '@/domain/meal-log/errors'
import type { FoodMasterRef, MealLogRow } from '@/domain/meal-log/types'

export interface InsertMealLogInput {
  readonly id: string
  readonly foodMasterId: string
  readonly eatenAt: Date
  readonly quantity: number
  readonly unit: string
  readonly note: string | null
}

export interface FoundMealLog {
  readonly log: MealLogRow
  readonly food: FoodMasterRef
}

export interface MealLogRepository {
  findFoodMaster(foodMasterId: string): ResultAsync<FoodMasterRef, DomainError>
  insertMealLog(input: InsertMealLogInput): ResultAsync<MealLogRow, DomainError>
  findMealLogById(id: string): ResultAsync<FoundMealLog | null, DomainError>
}
