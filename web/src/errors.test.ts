import { describe, expect, it } from 'vitest'

import { BoundaryError } from '#errors'

class TaskStorePersistenceError extends BoundaryError {}

describe('BoundaryError', () => {
  it('derives name from the subclass and preserves the original error as cause', () => {
    const original = new Error('connection refused')

    const wrapped = new TaskStorePersistenceError('failed to save', original)

    // Per-field assertions, not a single toEqual object: `wrapped` is a full
    // Error instance (own `stack` etc. would break a literal-object equality
    // check), and fohte/no-inline-object-in-expect forbids constructing a
    // partial-field object as the expect() target.
    expect(wrapped.name).toBe('TaskStorePersistenceError')
    expect(wrapped.message).toBe('failed to save')
    expect(wrapped.cause).toBe(original)
  })
})
