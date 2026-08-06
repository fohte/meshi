import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  type ResultAsync,
} from 'neverthrow'

import type { FoodMasterService } from '#domain/food-master/service'
import {
  type DomainError,
  FoodNameMismatchError,
  FutureEatenDateError,
  ImplausibleQuantityError,
  InvalidQuantityError,
  MealLogNotFoundError,
} from '#domain/meal-log/errors'
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
import { todayJstDateString } from '#lib/jst-date'

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
  basisUnit: string,
  units: Readonly<Record<string, number>>,
): Result<number, DomainError> =>
  resolveAmountGrams(quantity, unit, basisUnit, units).andThen((amountGrams) =>
    amountGrams > MAX_PLAUSIBLE_AMOUNT_GRAMS
      ? err(new ImplausibleQuantityError(amountGrams))
      : ok(amountGrams),
  )

// A caller-supplied foodName is a self-consistency check, not a fuzzy search:
// callers that pass it (the record_meal_log domain tool) already got the
// exact string from register_food_master/search_food_master output for this
// same food_master_id, so it should match verbatim modulo surrounding
// whitespace and case.
const normalizeFoodName = (name: string): string => name.trim().toLowerCase()

const checkFoodNameMatches = (
  foodName: string | undefined,
  actualName: string,
): Result<void, DomainError> =>
  foodName === undefined ||
  normalizeFoodName(foodName) === normalizeFoodName(actualName)
    ? ok(undefined)
    : err(new FoodNameMismatchError(foodName, actualName))

export interface MealLogService {
  record(input: RecordMealLogInput): ResultAsync<MealLogResult, DomainError>
  update(input: UpdateMealLogInput): ResultAsync<MealLogResult, DomainError>
  getById(id: string): ResultAsync<MealLogResult | null, DomainError>
  delete(id: string): ResultAsync<void, DomainError>
}

export interface MealLogServiceDeps {
  readonly repository: MealLogRepository
  readonly foodMasterService: FoodMasterService
  readonly idGenerator: () => string
  readonly now: () => Date
}

export const createMealLogService = (
  deps: MealLogServiceDeps,
): MealLogService => ({
  record(input) {
    if (input.eatenDate > todayJstDateString(deps.now())) {
      return errAsync(new FutureEatenDateError(input.eatenDate))
    }
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      return errAsync(new InvalidQuantityError(input.quantity))
    }
    return deps.repository
      .findFoodMaster(input.foodMasterId)
      .andThen((food) => {
        const nameCheck = checkFoodNameMatches(input.foodName, food.name)
        if (nameCheck.isErr()) return errAsync(nameCheck.error)
        const resolved = resolveAndCheckAmountGrams(
          input.quantity,
          input.unit,
          food.basisUnit,
          food.units,
        )
        if (resolved.isErr()) return errAsync(resolved.error)
        const amountGrams = resolved.value
        return deps.repository
          .insertMealLog({
            id: deps.idGenerator(),
            foodMasterId: input.foodMasterId,
            eatenDate: input.eatenDate,
            mealType: input.mealType,
            quantity: input.quantity,
            unit: input.unit,
            amountGrams,
          })
          .map((log) => buildResult(log, food))
      })
  },
  update(input) {
    if (
      input.eatenDate !== undefined &&
      input.eatenDate > todayJstDateString(deps.now())
    ) {
      return errAsync(new FutureEatenDateError(input.eatenDate))
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
        input.eatenDate === undefined &&
        input.mealType === undefined &&
        input.quantity === undefined &&
        input.unit === undefined
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
            food.basisUnit,
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
            ...(input.eatenDate === undefined
              ? {}
              : { eatenDate: input.eatenDate }),
            ...(input.mealType === undefined
              ? {}
              : { mealType: input.mealType }),
            ...(input.quantity === undefined
              ? {}
              : { quantity: input.quantity }),
            ...(input.unit === undefined ? {} : { unit: input.unit }),
            ...(amountGrams === undefined ? {} : { amountGrams }),
          })
          .andThen((log) =>
            newFoodMasterId === undefined
              ? okAsync(buildResult(log, food))
              : // Learn from the correction: the old food's name is what the
                // user's phrasing actually matched to the wrong food_master.
                // Recording it as an alias on the corrected one means the
                // same phrasing finds the right food next time. Best-effort —
                // a collision with an existing alias must not fail the
                // correction itself.
                deps.foodMasterService
                  .addAlias(newFoodMasterId, found.food.name)
                  .orElse(() => okAsync(undefined))
                  .map(() => buildResult(log, food)),
          )
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
  delete(id) {
    return deps.repository
      .deleteMealLog(id)
      .andThen((deleted) =>
        deleted ? okAsync(undefined) : errAsync(new MealLogNotFoundError(id)),
      )
  },
})

const buildResult = (log: MealLogRow, food: FoodMasterRef): MealLogResult => ({
  ...log,
  nutrition: scaleNutrition(
    food.nutritionPerBasis,
    log.amountGrams,
    food.basisQuantity,
  ),
  isEstimated: food.isEstimated,
})

// Nutrient values are scaled against the food's own basis_quantity;
// amountGrams is already resolved to the food's basis unit (see
// resolveAmountGrams).
const scaleNutrition = (
  perBasis: NutritionMap,
  amountGrams: number,
  basisQuantity: number,
): NutritionMap => {
  const multiplier = amountGrams / basisQuantity
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(perBasis)) {
    out[key] = value * multiplier
  }
  return out
}
