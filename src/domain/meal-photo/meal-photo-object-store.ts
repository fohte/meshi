import type { ResultAsync } from 'neverthrow'

import type { MealPhotoDomainError } from '#domain/meal-photo/errors'
import type { MealPhotoContentType } from '#domain/meal-photo/types'

export interface PutMealPhotoObjectInput {
  readonly objectKey: string
  readonly contentType: MealPhotoContentType
  readonly bytes: Uint8Array
}

export interface MealPhotoObjectStore {
  put(input: PutMealPhotoObjectInput): ResultAsync<void, MealPhotoDomainError>
  get(objectKey: string): ResultAsync<Uint8Array, MealPhotoDomainError>
  delete(objectKey: string): ResultAsync<void, MealPhotoDomainError>
}
