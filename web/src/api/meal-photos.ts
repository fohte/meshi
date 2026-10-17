import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { MealType } from '#api/day-detail'
import { MEAL_TYPES } from '#api/day-detail'
import { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'

export const MAX_MEAL_PHOTO_SIZE = 10 * 1024 * 1024

export const MEAL_PHOTO_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

const mealPhotoSchema = z.object({
  id: z.string(),
  date: z.string(),
  mealType: z.enum(MEAL_TYPES),
  contentType: z.enum(MEAL_PHOTO_CONTENT_TYPES),
  createdAt: z.iso.datetime(),
  contentUrl: z.string(),
})

const mealPhotosSchema = z.array(mealPhotoSchema)

export type MealPhoto = z.infer<typeof mealPhotoSchema>

export class MealPhotoRequestError extends ApiRequestError {
  readonly status: number

  constructor(path: string, status: number) {
    super(`${path} responded with ${String(status)}`, undefined)
    this.status = status
  }
}

export const mealPhotosQueryKey = (date: string, mealType: MealType) =>
  ['meal-photos', date, mealType] as const

const mealPhotoPath = (date: string, mealType: MealType): string =>
  `/api/meal-photos/${encodeURIComponent(date)}/${encodeURIComponent(mealType)}`

export const fetchMealPhotos = (
  date: string,
  mealType: MealType,
): ResultAsync<ReadonlyArray<MealPhoto>, ApiRequestError> =>
  requestJson(mealPhotoPath(date, mealType), mealPhotosSchema)

export const uploadMealPhoto = (
  date: string,
  mealType: MealType,
  photo: File,
): ResultAsync<MealPhoto, ApiRequestError> => {
  const path = mealPhotoPath(date, mealType)
  const body = new FormData()
  body.set('photo', photo)

  return requestJson(
    path,
    mealPhotoSchema,
    { method: 'POST', body },
    (res) => new MealPhotoRequestError(path, res.status),
  )
}

export const deleteMealPhoto = (
  id: string,
): ResultAsync<void, ApiRequestError> => {
  const path = `/api/meal-photos/${encodeURIComponent(id)}`
  return ResultAsync.fromPromise(
    fetch(path, { method: 'DELETE' }),
    (cause) => new ApiRequestError(`request to ${path} failed`, cause),
  ).andThen((response) => {
    if (!response.ok) {
      return errAsync(
        new ApiRequestError(
          `${path} responded with ${String(response.status)}`,
          undefined,
        ),
      )
    }
    return okAsync(undefined)
  })
}
