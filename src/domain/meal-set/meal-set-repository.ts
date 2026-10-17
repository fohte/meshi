import type { ResultAsync } from 'neverthrow'

import type { MealSetDomainError } from '#domain/meal-set/errors'
import type { MealSet, MealSetItemInput } from '#domain/meal-set/types'

export interface MealSetWrite {
  readonly id: string
  readonly name: string
  readonly items: ReadonlyArray<MealSetItemInput>
}

export interface MealSetRepository {
  create(input: MealSetWrite): ResultAsync<MealSet, MealSetDomainError>
  list(): ResultAsync<ReadonlyArray<MealSet>, MealSetDomainError>
  findById(id: string): ResultAsync<MealSet | null, MealSetDomainError>
  update(input: MealSetWrite): ResultAsync<MealSet, MealSetDomainError>
  // Resolves to false when no row matched so the service can return a not-found error.
  delete(id: string): ResultAsync<boolean, MealSetDomainError>
  // The service passes a trimmed, non-empty query and a positive integer limit.
  searchByName(
    query: string,
    limit: number,
  ): ResultAsync<ReadonlyArray<MealSet>, MealSetDomainError>
}
