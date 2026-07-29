import type { ResultAsync } from 'neverthrow'

// TanStack Query's queryFn/mutationFn contract signals failure by rejecting
// the promise, so this is the one boundary where a Result is converted back
// into a throw (see CLAUDE.md's error handling rules for this repo).
export const toPromise = async <T, E extends Error>(
  result: ResultAsync<T, E>,
): Promise<T> => {
  const settled = await result
  if (settled.isErr()) {
    // eslint-disable-next-line no-restricted-syntax -- interop boundary: TanStack Query requires a rejected promise on failure
    throw settled.error
  }
  return settled.value
}
