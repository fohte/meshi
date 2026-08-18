import { captureWithFingerprint } from '@fohte/service-kit/observability'
import type { Context } from 'hono'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import type { z } from 'zod'

// '{{ default }}' keeps Sentry's own grouping (exception type/value/stacktrace)
// alongside the custom key, so distinct errors reaching this catch-all still
// split into separate issues instead of collapsing into one.
const API_FINGERPRINT = ['api.request-failed', '{{ default }}']

export const jsonBadRequest = (c: Context, message: string): Response =>
  c.json({ error: message }, 400)

export const jsonServerError = (c: Context, err: Error): Response => {
  console.error('api request failed:', err)
  captureWithFingerprint(err, API_FINGERPRINT)
  return c.json({ error: err.message }, 500)
}

// Shared by every route with a JSON request body: parse-as-JSON, then
// validate against the route's zod schema, collapsing both failure modes
// into the same 400 response shape used across all routes.
export const parseJsonBody = <Schema extends z.ZodType>(
  c: Context,
  schema: Schema,
): ResultAsync<z.infer<Schema>, Response> =>
  ResultAsync.fromPromise(
    c.req.json(),
    () => new Error('request body must be valid JSON'),
  )
    .mapErr((err) => jsonBadRequest(c, err.message))
    .andThen((raw: unknown) => {
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        return errAsync(
          jsonBadRequest(
            c,
            parsed.error.issues.map((issue) => issue.message).join('; '),
          ),
        )
      }
      return okAsync(parsed.data)
    })
