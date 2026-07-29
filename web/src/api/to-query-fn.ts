import type { ResultAsync } from 'neverthrow'

// Deferred until invoked: building the ResultAsync eagerly at the call site
// would fire the underlying fetch on every render regardless of
// `enabled`/caching.
export const toQueryFn =
  <T, E extends Error>(
    makeResultAsync: () => ResultAsync<T, E>,
  ): (() => Promise<T>) =>
  async () => {
    const result = await makeResultAsync()
    // TanStack Query signals failure via a rejected Promise, not `throw`
    // (errorHandling's no-restricted-syntax rule forbids ThrowStatement here).
    if (result.isErr()) return Promise.reject(result.error)
    return result.value
  }
