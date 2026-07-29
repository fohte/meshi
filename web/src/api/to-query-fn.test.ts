import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { toQueryFn } from '#api/to-query-fn'
import { BoundaryError } from '#errors'

class StubError extends BoundaryError {}

describe('toQueryFn', () => {
  it('resolves with the value on Ok', async () => {
    const queryFn = toQueryFn(() => okAsync('value'))

    await expect(queryFn()).resolves.toBe('value')
  })

  it('rejects with the error on Err', async () => {
    const error = new StubError('boom', undefined)
    const queryFn = toQueryFn(() => errAsync(error))

    await expect(queryFn()).rejects.toBe(error)
  })

  it('defers calling the factory until the returned function is invoked', () => {
    let called = false
    const queryFn = toQueryFn(() => {
      called = true
      return okAsync('value')
    })

    expect(called).toBe(false)
    void queryFn()
    expect(called).toBe(true)
  })
})
