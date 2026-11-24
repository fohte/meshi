import { captureException } from '@fohte/service-kit/observability'
import { describe, expect, it, vi } from 'vitest'

import { captureShutdownErrors } from '#shutdown'

vi.mock('@fohte/service-kit/observability', () => ({
  captureException: vi.fn(),
}))

describe('captureShutdownErrors', () => {
  it('captures rejected operations before shutting down observability', async () => {
    const events: string[] = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(captureException).mockImplementation((error) => {
      events.push(
        `capture:${error instanceof Error ? error.message : String(error)}`,
      )
      return 'event-id'
    })

    await captureShutdownErrors(
      [
        { status: 'rejected', reason: new Error('resource cleanup failed') },
        { status: 'fulfilled', value: undefined },
      ],
      () => {
        events.push('shutdown')
        return Promise.resolve()
      },
    )

    expect(events).toEqual(['capture:resource cleanup failed', 'shutdown'])
  })
})
