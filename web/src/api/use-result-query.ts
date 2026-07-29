import {
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query'
import type { ResultAsync } from 'neverthrow'

// Bridges a neverthrow Result-returning fetcher into TanStack Query's
// throw-to-signal-failure contract, so every API hook doesn't need to
// perform the same isErr()/throw dance.
export const useResultQuery = <T, E extends Error>(
  queryKey: readonly unknown[],
  queryFn: () => ResultAsync<T, E>,
  options?: Omit<UseQueryOptions<T, E>, 'queryKey' | 'queryFn'>,
): UseQueryResult<T, E> =>
  useQuery({
    queryKey,
    queryFn: async () => {
      const result = await queryFn()
      if (result.isErr()) {
        // eslint-disable-next-line no-restricted-syntax -- TanStack Query's queryFn contract signals failure by throwing; this is the Result-to-throw interop boundary
        throw result.error
      }
      return result.value
    },
    ...options,
  })
