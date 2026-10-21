import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  type ResultAsync,
} from 'neverthrow'

import { defaultIdGenerator, type IdGenerator } from '#domain/food-master/id'
import {
  DuplicateMealSetFoodMasterError,
  EmptyMealSetItemsError,
  EmptyMealSetNameError,
  InvalidMealSetQuantityError,
  type MealSetDomainError,
  MealSetNotFoundError,
} from '#domain/meal-set/errors'
import type { MealSetRepository } from '#domain/meal-set/meal-set-repository'
import type {
  MealSet,
  MealSetItemInput,
  RegisterMealSetInput,
  UpdateMealSetInput,
} from '#domain/meal-set/types'

const SEARCH_LIMIT = 20

interface NormalizedMealSetInput {
  readonly name: string
  readonly items: ReadonlyArray<MealSetItemInput>
}

const normalizeInput = (
  input: RegisterMealSetInput,
): Result<NormalizedMealSetInput, MealSetDomainError> => {
  const name = input.name.trim()
  if (name === '') return err(new EmptyMealSetNameError())
  if (input.items.length === 0) return err(new EmptyMealSetItemsError())

  const seenFoodMasterIds = new Set<string>()
  for (const item of input.items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      return err(
        new InvalidMealSetQuantityError(item.foodMasterId, item.quantity),
      )
    }
    if (seenFoodMasterIds.has(item.foodMasterId)) {
      return err(new DuplicateMealSetFoodMasterError(item.foodMasterId))
    }
    seenFoodMasterIds.add(item.foodMasterId)
  }

  return ok({ name, items: input.items })
}

export interface MealSetService {
  register(
    input: RegisterMealSetInput,
  ): ResultAsync<MealSet, MealSetDomainError>
  list(): ResultAsync<ReadonlyArray<MealSet>, MealSetDomainError>
  getById(id: string): ResultAsync<MealSet | null, MealSetDomainError>
  update(input: UpdateMealSetInput): ResultAsync<MealSet, MealSetDomainError>
  delete(id: string): ResultAsync<void, MealSetDomainError>
  searchByName(
    name: string,
    limit?: number,
  ): ResultAsync<ReadonlyArray<MealSet>, MealSetDomainError>
}

export interface MealSetServiceDeps {
  readonly repository: MealSetRepository
  readonly idGenerator?: IdGenerator
}

export const createMealSetService = (
  deps: MealSetServiceDeps,
): MealSetService => {
  const idGenerator = deps.idGenerator ?? defaultIdGenerator

  return {
    register(input) {
      const normalized = normalizeInput(input)
      if (normalized.isErr()) return errAsync(normalized.error)
      return deps.repository.create({
        id: idGenerator('ms'),
        ...normalized.value,
      })
    },
    list: () => deps.repository.list(),
    getById: (id) => deps.repository.findById(id),
    update(input) {
      const normalized = normalizeInput(input)
      if (normalized.isErr()) return errAsync(normalized.error)
      return deps.repository.update({ id: input.id, ...normalized.value })
    },
    delete(id) {
      return deps.repository
        .delete(id)
        .andThen((deleted) =>
          deleted ? okAsync(undefined) : errAsync(new MealSetNotFoundError(id)),
        )
    },
    searchByName(name, limit = SEARCH_LIMIT) {
      const query = name.trim()
      const normalizedLimit = Math.trunc(limit)
      if (query === '' || !Number.isFinite(limit) || normalizedLimit <= 0) {
        return okAsync([])
      }
      return deps.repository.searchByName(query, normalizedLimit)
    },
  }
}
