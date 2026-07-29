import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import type { z } from 'zod'

import { ApiRequestError } from '#api/errors'

// Every /api call funnels through here so fetch failures, non-2xx statuses,
// and response-shape mismatches all surface as the same ApiRequestError.
export const requestJson = <Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init?: RequestInit,
): ResultAsync<z.infer<Schema>, ApiRequestError> =>
  ResultAsync.fromPromise(
    fetch(path, init),
    (cause) => new ApiRequestError(`request to ${path} failed`, cause),
  )
    .andThen((res) => {
      if (!res.ok) {
        return errAsync(
          new ApiRequestError(
            `${path} responded with ${String(res.status)}`,
            undefined,
          ),
        )
      }
      return ResultAsync.fromPromise(
        res.json() as Promise<unknown>,
        (cause) =>
          new ApiRequestError(
            `failed to parse ${path} response as JSON`,
            cause,
          ),
      )
    })
    .andThen((body) => {
      const parsed = schema.safeParse(body)
      if (!parsed.success) {
        return errAsync(
          new ApiRequestError(
            `${path} response did not match the expected schema`,
            parsed.error,
          ),
        )
      }
      return okAsync(parsed.data)
    })
