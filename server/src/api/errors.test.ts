import { captureWithFingerprint } from '@fohte/service-kit/observability'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { jsonServerError } from '#api/errors'
import { SENTRY_DEFAULT_GROUPING } from '#errors'

vi.mock('@fohte/service-kit/observability', () => ({
  captureWithFingerprint: vi.fn(),
}))

describe('jsonServerError', () => {
  it('reports the error under the catch-all fingerprint and returns a 500', async () => {
    const app = new Hono()
    app.get('/boom', (c) => jsonServerError(c, new Error('boom')))

    const res = await app.request('/boom')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
    expect(captureWithFingerprint).toHaveBeenCalledExactlyOnceWith(
      expect.any(Error),
      ['api.request-failed', SENTRY_DEFAULT_GROUPING],
    )
  })
})
