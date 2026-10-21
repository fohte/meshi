import { err, errAsync, ResultAsync } from 'neverthrow'

import type { MealType } from '#domain/meal-log/types'
import {
  InvalidMealPhotoDateError,
  MealPhotoConsistencyError,
  type MealPhotoDomainError,
  MealPhotoNotFoundError,
} from '#domain/meal-photo/errors'
import type { MealPhotoObjectStore } from '#domain/meal-photo/meal-photo-object-store'
import type {
  InsertMealPhotoInput,
  MealPhotoRepository,
} from '#domain/meal-photo/meal-photo-repository'
import type {
  MealPhotoContent,
  MealPhotoContentType,
  MealPhotoRow,
} from '#domain/meal-photo/types'
import { isValidJstCalendarDateString, type JstDate } from '#lib/jst-date'

interface UploadMealPhotoInput {
  readonly date: JstDate
  readonly mealType: MealType
  readonly contentType: MealPhotoContentType
  readonly bytes: Uint8Array
}

export interface MealPhotoService {
  upload(
    input: UploadMealPhotoInput,
  ): ResultAsync<MealPhotoRow, MealPhotoDomainError>
  listForMeal(
    date: JstDate,
    mealType: MealType,
  ): ResultAsync<ReadonlyArray<MealPhotoRow>, MealPhotoDomainError>
  getContent(id: string): ResultAsync<MealPhotoContent, MealPhotoDomainError>
  delete(id: string): ResultAsync<void, MealPhotoDomainError>
}

export interface MealPhotoServiceDeps {
  readonly repository: MealPhotoRepository
  readonly objectStore: MealPhotoObjectStore
  readonly idGenerator: () => string
}

const validateDate = (date: JstDate): MealPhotoDomainError | undefined =>
  isValidJstCalendarDateString(date)
    ? undefined
    : new InvalidMealPhotoDateError(date)

const cleanupAfterInsertFailure = (
  objectStore: MealPhotoObjectStore,
  objectKey: string,
  persistenceError: MealPhotoDomainError,
): ResultAsync<never, MealPhotoDomainError> =>
  ResultAsync.fromSafePromise(
    objectStore.delete(objectKey).match(
      () => err(persistenceError),
      (cleanupError) =>
        err(
          new MealPhotoConsistencyError(
            'failed to remove the uploaded object after metadata insert failed',
            cleanupError,
          ),
        ),
    ),
  ).andThen((result) => result)

const restoreAfterDeleteFailure = (
  repository: MealPhotoRepository,
  photo: MealPhotoRow,
  storageError: MealPhotoDomainError,
): ResultAsync<never, MealPhotoDomainError> =>
  ResultAsync.fromSafePromise(
    repository
      .insert({
        id: photo.id,
        date: photo.date,
        mealType: photo.mealType,
        objectKey: photo.objectKey,
        contentType: photo.contentType,
        createdAt: photo.createdAt,
      })
      .match(
        () => err(storageError),
        (restoreError) =>
          err(
            new MealPhotoConsistencyError(
              'failed to restore photo metadata after object deletion failed',
              restoreError,
            ),
          ),
      ),
  ).andThen((result) => result)

export const createMealPhotoService = (
  deps: MealPhotoServiceDeps,
): MealPhotoService => ({
  upload(input) {
    const dateError = validateDate(input.date)
    if (dateError !== undefined) return errAsync(dateError)

    const id = deps.idGenerator()
    const objectKey = `meal-photos/${id}`
    const row: InsertMealPhotoInput = {
      id,
      date: input.date,
      mealType: input.mealType,
      objectKey,
      contentType: input.contentType,
    }

    return deps.objectStore
      .put({ objectKey, contentType: input.contentType, bytes: input.bytes })
      .andThen(() =>
        deps.repository
          .insert(row)
          .orElse((persistenceError) =>
            cleanupAfterInsertFailure(
              deps.objectStore,
              objectKey,
              persistenceError,
            ),
          ),
      )
  },
  listForMeal(date, mealType) {
    const dateError = validateDate(date)
    if (dateError !== undefined) return errAsync(dateError)
    return deps.repository.findForMeal(date, mealType)
  },
  getContent(id) {
    return deps.repository.findById(id).andThen((photo) => {
      if (photo === null) return errAsync(new MealPhotoNotFoundError(id))
      return deps.objectStore
        .get(photo.objectKey)
        .map((bytes) => ({ photo, bytes }))
    })
  },
  delete(id) {
    return deps.repository.deleteById(id).andThen((photo) => {
      if (photo === null) return errAsync(new MealPhotoNotFoundError(id))
      return deps.objectStore
        .delete(photo.objectKey)
        .map(() => undefined)
        .orElse((storageError) =>
          restoreAfterDeleteFailure(deps.repository, photo, storageError),
        )
    })
  },
})
