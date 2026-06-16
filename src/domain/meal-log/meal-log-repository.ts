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
  /**
   * Throws FoodMasterNotFoundError when foodMasterId does not exist.
   */
  findFoodMaster(foodMasterId: string): Promise<FoodMasterRef>
  insertMealLog(input: InsertMealLogInput): Promise<MealLogRow>
  findMealLogById(id: string): Promise<FoundMealLog | null>
}
