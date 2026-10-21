export interface IdCounter {
  next(): number
}

export const createCountingIdGenerator = (
  counter: IdCounter,
): ((prefix: string) => string) => {
  return (prefix) => `${prefix}_test_${String(counter.next()).padStart(4, '0')}`
}
