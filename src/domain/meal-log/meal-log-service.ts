import { errAsync, type ResultAsync } from 'neverthrow'

import {
  type DomainError,
  FutureEatenAtError,
  ImplausibleQuantityError,
  InvalidQuantityError,
} from '#domain/meal-log/errors'
import { inferMealType } from '#domain/meal-log/infer-meal-type'
import type { MealLogRepository } from '#domain/meal-log/meal-log-repository'
import { resolveAmountGrams } from '#domain/meal-log/resolve-amount-grams'
import type {
  FoodMasterRef,
  MealLogResult,
  MealLogRow,
  NutritionMap,
  RecordMealLogInput,
} from '#domain/meal-log/types'

// A resolved amount larger than this isn't a realistic single meal; reject
// it rather than silently recording it (e.g. a unit mixup inflating the
// gram amount by orders of magnitude).
const MAX_PLAUSIBLE_AMOUNT_GRAMS = 10_000

export interface MealLogService {
  record(input: RecordMealLogInput): ResultAsync<MealLogResult, DomainError>
  getById(id: string): ResultAsync<MealLogResult | null, DomainError>
}

export interface MealLogServiceDeps {
  readonly repository: MealLogRepository
  readonly idGenerator: () => string
  readonly now: () => Date
}

export const createMealLogService = (
  deps: MealLogServiceDeps,
): MealLogService => ({
  record(input) {
    if (input.eatenAt.getTime() > deps.now().getTime()) {
      return errAsync(new FutureEatenAtError(input.eatenAt))
    }
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      return errAsync(new InvalidQuantityError(input.quantity))
    }
    return deps.repository
      .findFoodMaster(input.foodMasterId)
      .andThen((food) => {
        const resolved = resolveAmountGrams(
          input.quantity,
          input.unit,
          food.units,
        )
        if (resolved.isErr()) return errAsync(resolved.error)
        const amountGrams = resolved.value
        if (amountGrams > MAX_PLAUSIBLE_AMOUNT_GRAMS) {
          return errAsync(new ImplausibleQuantityError(amountGrams))
        }
        return deps.repository
          .insertMealLog({
            id: deps.idGenerator(),
            foodMasterId: input.foodMasterId,
            eatenAt: input.eatenAt,
            mealType: input.mealType ?? inferMealType(input.eatenAt),
            quantity: input.quantity,
            unit: input.unit,
            amountGrams,
            note: input.note ?? null,
          })
          .map((log) => buildResult(log, food))
      })
  },
  getById(id) {
    return deps.repository
      .findMealLogById(id)
      .map((found) =>
        found === null ? null : buildResult(found.log, found.food),
      )
  },
})

const buildResult = (log: MealLogRow, food: FoodMasterRef): MealLogResult => ({
  ...log,
  nutrition: scaleNutrition(food.nutritionPer100g, log.amountGrams),
  isEstimated: food.isEstimated,
})

// food_master nutrient values are stored per 100g; amountGrams already
// resolved quantity+unit to grams (see resolveAmountGrams).
const scaleNutrition = (
  per100g: NutritionMap,
  amountGrams: number,
): NutritionMap => {
  const multiplier = amountGrams / 100
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(per100g)) {
    out[key] = value * multiplier
  }
  return out
}
