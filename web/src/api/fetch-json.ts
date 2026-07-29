import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import type { z } from 'zod'

import { BoundaryError } from '#errors'

export class ApiRequestError extends BoundaryError {}

export const fetchJson = <Schema extends z.ZodType>(
  url: string,
  schema: Schema,
): ResultAsync<z.infer<Schema>, ApiRequestError> =>
  ResultAsync.fromPromise(
    fetch(url),
    (caughtErr) =>
      new ApiRequestError(`network error fetching ${url}`, caughtErr),
  )
    .andThen((res) => {
      if (!res.ok) {
        return errAsync(
          new ApiRequestError(
            `${url} responded with ${String(res.status)}`,
            undefined,
          ),
        )
      }
      return ResultAsync.fromPromise(
        res.json(),
        (caughtErr) =>
          new ApiRequestError(`failed to parse JSON from ${url}`, caughtErr),
      )
    })
    .andThen((json) => {
      const parsed = schema.safeParse(json)
      if (!parsed.success) {
        return errAsync(
          new ApiRequestError(
            `invalid response shape from ${url}`,
            parsed.error,
          ),
        )
      }
      return okAsync(parsed.data)
    })
