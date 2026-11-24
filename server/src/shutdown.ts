import { captureException } from '@fohte/service-kit/observability'

export const captureShutdownErrors = async (
  results: readonly PromiseSettledResult<unknown>[],
  shutdown: () => Promise<void> | undefined,
): Promise<void> => {
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('shutdown error:', result.reason)
      captureException(result.reason)
    }
  }
  await shutdown()
}
