import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import type { MealType } from '#api/day-detail'
import { ApiRequestError } from '#api/errors'

const mealSkipPath = (date: string, mealType: MealType): string =>
  `/api/meal-skips/${encodeURIComponent(date)}/${encodeURIComponent(mealType)}`

// requestJson always parses the body as JSON, but the response body here
// (a 200 on PUT, 204 on DELETE) is never needed by the caller — only
// success/failure matters, so this skips requestJson like deleteMealLog does.
const requestNoContent = (
  path: string,
  method: 'PUT' | 'DELETE',
): ResultAsync<void, ApiRequestError> =>
  ResultAsync.fromPromise(
    fetch(path, { method }),
    (cause) => new ApiRequestError(`request to ${path} failed`, cause),
  ).andThen((res) => {
    if (!res.ok) {
      return errAsync(
        new ApiRequestError(
          `${path} responded with ${String(res.status)}`,
          undefined,
        ),
      )
    }
    return okAsync(undefined)
  })

export const putMealSkip = (
  date: string,
  mealType: MealType,
): ResultAsync<void, ApiRequestError> =>
  requestNoContent(mealSkipPath(date, mealType), 'PUT')

export const deleteMealSkip = (
  date: string,
  mealType: MealType,
): ResultAsync<void, ApiRequestError> =>
  requestNoContent(mealSkipPath(date, mealType), 'DELETE')
