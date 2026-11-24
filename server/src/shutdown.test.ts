import { captureException } from '@fohte/service-kit/observability'
import { describe, expect, it, vi } from 'vitest'

import { captureShutdownErrors } from '#shutdown'

vi.mock('@fohte/service-kit/observability', () => ({
  captureException: vi.fn(),
}))

describe('captureShutdownErrors', () => {
  it('captures rejected operations before shutting down observability', async () => {
    const events: Array<
      { type: 'capture'; error: unknown } | { type: 'shutdown' }
    > = []
    const error = Object.assign(new Error('resource cleanup failed'), {
      code: 'cleanup_failure',
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(captureException).mockImplementation((error) => {
      events.push({ type: 'capture', error })
      return 'event-id'
    })

    await captureShutdownErrors(
      [
        { status: 'rejected', reason: error },
        { status: 'fulfilled', value: undefined },
      ],
      () => {
        events.push({ type: 'shutdown' })
        return Promise.resolve()
      },
    )

    expect(events).toEqual([{ type: 'capture', error }, { type: 'shutdown' }])
  })
})
