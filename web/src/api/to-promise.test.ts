import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { toPromise } from '#api/to-promise'

describe('toPromise', () => {
  it('resolves with the value when the result is Ok', async () => {
    await expect(toPromise(okAsync('value'))).resolves.toBe('value')
  })

  it('rejects with the error when the result is Err', async () => {
    const error = new Error('boom')
    await expect(toPromise(errAsync(error))).rejects.toBe(error)
  })
})
