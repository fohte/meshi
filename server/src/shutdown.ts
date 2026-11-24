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
  // Runs after the captures above, not concurrently with them:
  // observability.shutdown() closes the Sentry client, and a
  // captureException call made after close() is silently dropped.
  await shutdown()
}
