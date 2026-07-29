import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  type ResultAsync,
} from 'neverthrow'

import {
  type DomainError,
  FutureEatenAtError,
  ImplausibleQuantityError,
  InvalidQuantityError,
  MealLogNotFoundError,
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
  UpdateMealLogInput,
} from '#domain/meal-log/types'

// A resolved amount larger than this isn't a realistic single meal; reject
// it rather than silently recording it (e.g. a unit mixup inflating the
// gram amount by orders of magnitude).
const MAX_PLAUSIBLE_AMOUNT_GRAMS = 10_000

// Shared by record() and update(): resolves quantity+unit to grams and
// rejects an implausible result, so both call sites apply the same
// resolution + plausibility rule.
const resolveAndCheckAmountGrams = (
  quantity: number,
  unit: string,
  units: Readonly<Record<string, number>>,
): Result<number, DomainError> =>
  resolveAmountGrams(quantity, unit, units).andThen((amountGrams) =>
    amountGrams > MAX_PLAUSIBLE_AMOUNT_GRAMS
      ? err(new ImplausibleQuantityError(amountGrams))
      : ok(amountGrams),
  )

export interface MealLogService {
  record(input: RecordMealLogInput): ResultAsync<MealLogResult, DomainError>
  update(input: UpdateMealLogInput): ResultAsync<MealLogResult, DomainError>
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
        const resolved = resolveAndCheckAmountGrams(
          input.quantity,
          input.unit,
          food.units,
        )
        if (resolved.isErr()) return errAsync(resolved.error)
        const amountGrams = resolved.value
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
  update(input) {
    if (
      input.eatenAt !== undefined &&
      input.eatenAt.getTime() > deps.now().getTime()
    ) {
      return errAsync(new FutureEatenAtError(input.eatenAt))
    }
    if (
      input.quantity !== undefined &&
      (!Number.isFinite(input.quantity) || input.quantity <= 0)
    ) {
      return errAsync(new InvalidQuantityError(input.quantity))
    }
    return deps.repository.findMealLogById(input.id).andThen((found) => {
      if (found === null) return errAsync(new MealLogNotFoundError(input.id))
      // Skip the update round-trip when the patch carries no fields — an empty
      // `.set({})` would reach the repository with nothing to assign.
      if (
        input.foodMasterId === undefined &&
        input.eatenAt === undefined &&
        input.mealType === undefined &&
        input.quantity === undefined &&
        input.unit === undefined &&
        input.note === undefined
      ) {
        return okAsync(buildResult(found.log, found.food))
      }
      const newFoodMasterId =
        input.foodMasterId !== undefined &&
        input.foodMasterId !== found.log.foodMasterId
          ? input.foodMasterId
          : undefined
      const foodRef =
        newFoodMasterId === undefined
          ? okAsync(found.food)
          : deps.repository.findFoodMaster(newFoodMasterId)
      return foodRef.andThen((food) => {
        // A changed quantity/unit obviously changes the resolved gram amount;
        // re-pointing food_master_id can too, since the same unit string may
        // resolve to a different food_master_unit (or none) on the new food.
        const needsResolve =
          input.quantity !== undefined ||
          input.unit !== undefined ||
          newFoodMasterId !== undefined
        let amountGrams: number | undefined
        if (needsResolve) {
          const resolved = resolveAndCheckAmountGrams(
            input.quantity ?? found.log.quantity,
            input.unit ?? found.log.unit,
            food.units,
          )
          if (resolved.isErr()) return errAsync(resolved.error)
          amountGrams = resolved.value
        }
        return deps.repository
          .updateMealLog({
            id: input.id,
            ...(input.foodMasterId === undefined
              ? {}
              : { foodMasterId: input.foodMasterId }),
            ...(input.eatenAt === undefined ? {} : { eatenAt: input.eatenAt }),
            ...(input.mealType === undefined
              ? {}
              : { mealType: input.mealType }),
            ...(input.quantity === undefined
              ? {}
              : { quantity: input.quantity }),
            ...(input.unit === undefined ? {} : { unit: input.unit }),
            ...(amountGrams === undefined ? {} : { amountGrams }),
            ...(input.note === undefined ? {} : { note: input.note }),
          })
          .map((log) => buildResult(log, food))
      })
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
