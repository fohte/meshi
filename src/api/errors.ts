import { captureWithFingerprint } from '@fohte/service-kit/observability'
import type { Context } from 'hono'

const API_FINGERPRINT = 'api.request-failed'

export const jsonBadRequest = (c: Context, message: string): Response =>
  c.json({ error: message }, 400)

export const jsonServerError = (c: Context, err: Error): Response => {
  console.error('api request failed:', err)
  captureWithFingerprint(err, API_FINGERPRINT)
  return c.json({ error: err.message }, 500)
}
