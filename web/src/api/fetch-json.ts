import { err, ok, ResultAsync } from 'neverthrow'
import type { z } from 'zod'

import { ApiRequestError, ApiResponseShapeError } from '#api/errors'

// Exported so callers that need to special-case a status code (e.g. mapping
// 404 to a domain-specific "not found" error) can still reuse the
// parse-and-validate half of the pipeline instead of duplicating it.
export const parseJsonResponse = <T>(
  res: Response,
  url: string,
  schema: z.ZodType<T>,
): ResultAsync<T, ApiRequestError | ApiResponseShapeError> =>
  ResultAsync.fromPromise(
    res.json() as Promise<unknown>,
    (caughtErr) =>
      new ApiRequestError(`failed to parse JSON from ${url}`, caughtErr),
  ).andThen((body) => {
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return err(
        new ApiResponseShapeError(
          `response from ${url} did not match the expected shape`,
          parsed.error,
        ),
      )
    }
    return ok(parsed.data)
  })

export const fetchJson = <T>(
  url: string,
  schema: z.ZodType<T>,
): ResultAsync<T, ApiRequestError | ApiResponseShapeError> =>
  ResultAsync.fromPromise(
    fetch(url),
    (caughtErr) => new ApiRequestError(`request to ${url} failed`, caughtErr),
  )
    .andThen((res) => {
      if (!res.ok) {
        return err(
          new ApiRequestError(
            `request to ${url} failed with status ${String(res.status)}`,
            res.status,
          ),
        )
      }
      return ok(res)
    })
    .andThen((res) => parseJsonResponse(res, url, schema))
