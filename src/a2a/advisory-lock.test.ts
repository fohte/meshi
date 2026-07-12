import { expect, it } from 'vitest'

import { withAdvisoryLock } from '@/a2a/advisory-lock'
import { describeIfDb, getTestSql } from '@/test/db'

// Reserves its own connection to probe the lock so the probe itself can
// never be mistaken for the lock held by withAdvisoryLock's connection —
// unlike the pool's round-robin connections, pg_try_advisory_lock and its
// matching unlock are guaranteed to land on the same session this way.
const probeAdvisoryLock = async (lockKey: string): Promise<boolean> => {
  const reserved = await getTestSql().reserve()
  try {
    const rows = await reserved<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked
    `
    const locked = rows[0]?.locked ?? false
    if (locked) {
      await reserved`SELECT pg_advisory_unlock(hashtext(${lockKey}))`
    }
    return locked
  } finally {
    reserved.release()
  }
}

describeIfDb('withAdvisoryLock', () => {
  it('returns the callback result', async () => {
    const result = await withAdvisoryLock(
      getTestSql(),
      'advisory-lock-test-result',
      () => Promise.resolve('done'),
    )

    expect(result).toBe('done')
  })

  it('holds the lock while the callback runs and releases it afterward', async () => {
    const lockKey = 'advisory-lock-test-hold'
    let heldDuringCallback: boolean | undefined

    await withAdvisoryLock(getTestSql(), lockKey, async () => {
      heldDuringCallback = await probeAdvisoryLock(lockKey)
    })

    expect(heldDuringCallback).toBe(false)
    expect(await probeAdvisoryLock(lockKey)).toBe(true)
  })

  it('releases the lock even when the callback throws', async () => {
    const lockKey = 'advisory-lock-test-throw'

    await expect(
      withAdvisoryLock(getTestSql(), lockKey, () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(await probeAdvisoryLock(lockKey)).toBe(true)
  })
})
