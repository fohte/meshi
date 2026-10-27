import { err, errAsync, ok, okAsync, Result, ResultAsync } from 'neverthrow'

import type { FoodMasterService } from '#domain/food-master/service'
import {
  type DomainError,
  FoodNameMismatchError,
  FutureEatenDateError,
  ImplausibleQuantityError,
  InvalidQuantityError,
  MealLogItemValidationError,
  MealLogNotFoundError,
  MealLogPersistenceError,
} from '#domain/meal-log/errors'
import type {
  MealLogRepository,
  MealLogWriteResult,
} from '#domain/meal-log/meal-log-repository'
import type {
  FoodMasterRef,
  MealLogDeletionResult,
  MealLogResult,
  NutritionMap,
  RecordMealLogInput,
  RecordMealLogItemInput,
  RecordMealLogItemResult,
  RecordMealLogsInput,
  UpdateMealLogInput,
} from '#domain/meal-log/types'
import { toJstDateString } from '#lib/jst-date'

// A caller-supplied foodName is a self-consistency check, not a fuzzy search:
// MCP callers resolve foodMasterId through search_foods, so the name should
// match that result modulo surrounding whitespace and case.
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

const validateRecordItem = (
  repository: MealLogRepository,
  item: Pick<RecordMealLogInput, 'foodMasterId' | 'foodName' | 'quantity'>,
): ResultAsync<FoodMasterRef, DomainError> => {
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
    return errAsync(new InvalidQuantityError(item.quantity))
  }
  return repository.findFoodMaster(item.foodMasterId).andThen((food) => {
    const nameCheck = checkFoodNameMatches(item.foodName, food.name)
    if (nameCheck.isErr()) return errAsync(nameCheck.error)
    const plausibility = checkPlausibleQuantity(
      food.nutritionPerUnit,
      item.quantity,
    )
    if (plausibility.isErr()) return errAsync(plausibility.error)
    return okAsync(food)
  })
}

export interface MealLogService {
  record(input: RecordMealLogInput): ResultAsync<MealLogResult, DomainError>
  recordMany(
    input: RecordMealLogsInput,
  ): ResultAsync<ReadonlyArray<RecordMealLogItemResult>, DomainError>
  update(input: UpdateMealLogInput): ResultAsync<MealLogResult, DomainError>
  getById(id: string): ResultAsync<MealLogResult | null, DomainError>
  delete(id: string): ResultAsync<void, DomainError>
  deleteMany(
    ids: ReadonlyArray<string>,
  ): ResultAsync<ReadonlyArray<MealLogDeletionResult>, DomainError>
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
    if (input.eatenDate > toJstDateString(deps.now())) {
      return errAsync(new FutureEatenDateError(input.eatenDate))
    }
    return validateRecordItem(deps.repository, input).andThen(() =>
      deps.repository
        .insertMealLog({
          id: deps.idGenerator(),
          foodMasterId: input.foodMasterId,
          eatenDate: input.eatenDate,
          mealType: input.mealType,
          quantity: input.quantity,
        })
        .andThen((log) =>
          buildResultFromStoredLog(deps.repository, log).map(
            ({ result }) => result,
          ),
        ),
    )
  },
  recordMany(input) {
    if (input.eatenDate > toJstDateString(deps.now())) {
      return errAsync(new FutureEatenDateError(input.eatenDate))
    }

    const validatedItems = input.items.reduce<
      ResultAsync<
        ReadonlyArray<{
          readonly item: RecordMealLogItemInput
          readonly food: FoodMasterRef
        }>,
        DomainError
      >
    >(
      (validated, item, index) =>
        validated.andThen((items) =>
          validateRecordItem(deps.repository, item)
            .mapErr((error) => new MealLogItemValidationError(index + 1, error))
            .map((food) => [...items, { item, food }]),
        ),
      okAsync([]),
    )

    return validatedItems.andThen((items) => {
      const plannedItems = items.map(({ item }) => ({
        insertInput: {
          id: deps.idGenerator(),
          foodMasterId: item.foodMasterId,
          eatenDate: input.eatenDate,
          mealType: input.mealType,
          quantity: item.quantity,
        },
      }))

      return deps.repository
        .insertMealLogs(plannedItems.map(({ insertInput }) => insertInput))
        .andThen((rows) => {
          const rowsById = new Map(rows.map((row) => [row.id, row] as const))
          return ResultAsync.combine(
            plannedItems.map(({ insertInput }) => {
              const row = rowsById.get(insertInput.id)
              return row === undefined
                ? errAsync(
                    new MealLogPersistenceError(
                      'meal_logs bulk insert returned incomplete rows',
                    ),
                  )
                : buildResultFromStoredLog(deps.repository, row).map(
                    ({ result, foodName }) => ({
                      ...result,
                      foodName,
                    }),
                  )
            }),
          )
        })
    })
  },
  update(input) {
    if (
      input.eatenDate !== undefined &&
      input.eatenDate > toJstDateString(deps.now())
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
          .andThen((log) => {
            // The user's phrasing matched the old food name, so preserve it as
            // an alias on the corrected food for future searches.
            const aliasResult =
              newFoodMasterId === undefined
                ? okAsync(undefined)
                : deps.foodMasterService
                    .addAlias(newFoodMasterId, found.food.name)
                    .mapErr(
                      (e) =>
                        new MealLogPersistenceError(
                          'failed to learn food_master alias',
                          e,
                        ),
                    )
            return aliasResult.andThen(() =>
              buildResultFromStoredLog(deps.repository, log).map(
                ({ result }) => result,
              ),
            )
          })
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
  deleteMany(ids) {
    return deps.repository.deleteMealLogs(ids)
  },
})

const buildResult = (
  log: MealLogWriteResult,
  food: FoodMasterRef,
): MealLogResult => ({
  ...log,
  nutrition: scaleNutrition(food.nutritionPerUnit, log.quantity),
  isEstimated: food.isEstimated,
  nutritionStatus: food.nutritionStatus,
})

const buildResultFromStoredLog = (
  repository: MealLogRepository,
  log: MealLogWriteResult,
): ResultAsync<{ result: MealLogResult; foodName: string }, DomainError> =>
  repository.findMealLogById(log.id).andThen((found) =>
    found === null
      ? errAsync(
          new MealLogPersistenceError(
            'meal_logs write returned no row when reloading its nutrition version',
          ),
        )
      : okAsync({
          result: buildResult(log, found.food),
          foodName: found.food.name,
        }),
  )

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
