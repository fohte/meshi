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
  MealLogPersistenceError,
} from '#domain/meal-log/errors'
import type { MealLogRepository } from '#domain/meal-log/meal-log-repository'
import type {
  FoodMasterRef,
  MealLogResult,
  MealLogRow,
  NutritionMap,
  RecordMealLogInput,
  UpdateMealLogInput,
} from '#domain/meal-log/types'
import { todayJstDateString } from '#lib/jst-date'

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

// A single meal_log's resolved energy shouldn't exceed this — catches a
// quantity mixup (e.g. passing a raw gram count as quantity against a food
// registered per serving) before it's silently recorded. Skipped when the
// food has no energy_kcal value to check against.
const MAX_PLAUSIBLE_ENERGY_KCAL = 5_000

const checkPlausibleQuantity = (
  nutritionPerUnit: NutritionMap,
  quantity: number,
): Result<void, DomainError> => {
  const energyKcalPerUnit = nutritionPerUnit['energy_kcal']
  if (energyKcalPerUnit === undefined) return ok(undefined)
  const resolvedEnergyKcal = energyKcalPerUnit * quantity
  return resolvedEnergyKcal > MAX_PLAUSIBLE_ENERGY_KCAL
    ? err(new ImplausibleQuantityError(resolvedEnergyKcal))
    : ok(undefined)
}

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
        const plausibility = checkPlausibleQuantity(
          food.nutritionPerUnit,
          input.quantity,
        )
        if (plausibility.isErr()) return errAsync(plausibility.error)
        return deps.repository
          .insertMealLog({
            id: deps.idGenerator(),
            foodMasterId: input.foodMasterId,
            eatenDate: input.eatenDate,
            mealType: input.mealType,
            quantity: input.quantity,
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
        input.quantity === undefined
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
        const effectiveQuantity = input.quantity ?? found.log.quantity
        const plausibility = checkPlausibleQuantity(
          food.nutritionPerUnit,
          effectiveQuantity,
        )
        if (plausibility.isErr()) return errAsync(plausibility.error)
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
          })
          .andThen((log) =>
            newFoodMasterId === undefined
              ? okAsync(buildResult(log, food))
              : // Learn from the correction: the old food's name is what the
                // user's phrasing actually matched to the wrong food_master.
                // Recording it as an alias on the corrected one means the
                // same phrasing finds the right food next time. addAlias
                // never errors on an alias collision (ON CONFLICT DO
                // NOTHING) — an error here is a genuine persistence failure,
                // which should surface rather than be silently discarded.
                deps.foodMasterService
                  .addAlias(newFoodMasterId, found.food.name)
                  .mapErr(
                    (e) =>
                      new MealLogPersistenceError(
                        'failed to learn food_master alias',
                        e,
                      ),
                  )
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
  nutrition: scaleNutrition(food.nutritionPerUnit, log.quantity),
  isEstimated: food.isEstimated,
})

const scaleNutrition = (
  perUnit: NutritionMap,
  quantity: number,
): NutritionMap => {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(perUnit)) {
    out[key] = value * quantity
  }
  return out
}
