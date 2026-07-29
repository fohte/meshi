import { errAsync, type ResultAsync } from 'neverthrow'

import {
  type DomainError,
  FutureEatenAtError,
  ImplausibleQuantityError,
  InvalidQuantityError,
} from '#domain/meal-log/errors'
import { inferMealType } from '#domain/meal-log/infer-meal-type'
import type { MealLogRepository } from '#domain/meal-log/meal-log-repository'
import type {
  FoodMasterRef,
  MealLogResult,
  MealLogRow,
  NutritionMap,
  RecordMealLogInput,
} from '#domain/meal-log/types'
import { resolveScaleMultiplier } from '#domain/meal-log/unit-scale'

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
    const scaleMultiplier = resolveScaleMultiplier(input.quantity, input.unit)
    if (scaleMultiplier > MAX_SCALE_MULTIPLIER) {
      return errAsync(
        new ImplausibleQuantityError(
          input.quantity,
          input.unit,
          scaleMultiplier,
        ),
      )
    }
    return deps.repository.findFoodMaster(input.foodMasterId).andThen((food) =>
      deps.repository
        .insertMealLog({
          id: deps.idGenerator(),
          foodMasterId: input.foodMasterId,
          eatenAt: input.eatenAt,
          mealType: input.mealType ?? inferMealType(input.eatenAt),
          quantity: input.quantity,
          unit: input.unit,
          note: input.note ?? null,
        })
        .map((log) => buildResult(log, food)),
    )
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
  nutrition: scaleNutrition(
    food.nutritionPer100g,
    resolveScaleMultiplier(log.quantity, log.unit),
  ),
  isEstimated: food.isEstimated,
})

// A single meal log entry scaling the per-100g reference by more than this is
// far outside what a real serving/quantity plausibly represents (e.g. 10kg/10L
// of one food, or 100 servings) and more likely means the unit was
// misinterpreted. Applied uniformly to every unit — including discrete serving
// units, not just the ones in GRAMS_PER_UNIT — since a unit the LLM invents
// that isn't recognized here would otherwise scale unchecked.
const MAX_SCALE_MULTIPLIER = 100

const scaleNutrition = (
  per100g: NutritionMap,
  multiplier: number,
): NutritionMap => {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(per100g)) {
    out[key] = value * multiplier
  }
  return out
}
