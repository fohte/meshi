import { errAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { ApiRequestError } from '#api/errors'

const apiErrorSchema = z.object({ error: z.string() })

export const parseApiError = (
  path: string,
  response: Response,
): ResultAsync<never, ApiRequestError> =>
  ResultAsync.fromPromise(
    response.json() as Promise<unknown>,
    (cause) =>
      new ApiRequestError(
        `${path} responded with ${String(response.status)}`,
        cause,
      ),
  ).andThen((body) => {
    const parsed = apiErrorSchema.safeParse(body)
    if (!parsed.success) {
      return errAsync(
        new ApiRequestError(
          `${path} responded with ${String(response.status)}`,
          parsed.error,
        ),
      )
    }
    return errAsync(new ApiRequestError(parsed.data.error, undefined))
  })
