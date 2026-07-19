import * as Sentry from '@sentry/node'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { withAdvisoryLock } from '@/a2a/advisory-lock'
import type { Sql } from '@/db'
import { describeIfDb, getTestSql } from '@/test/db'

vi.mock('@sentry/node', () => ({ captureException: vi.fn() }))

afterEach(() => {
  vi.mocked(Sentry.captureException).mockClear()
})

// Reserves its own connection to probe the lock so the probe itself can
// never be mistaken for the lock held by withAdvisoryLock's connection —
// unlike the pool's round-robin connections, pg_try_advisory_lock and its
// matching unlock are guaranteed to land on the same session this way.
const probeAdvisoryLock = async (lockKey: string): Promise<boolean> => {
  const reserved = await getTestSql().reserve()
  try {
    const rows = await reserved<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtextextended(${lockKey}, 0)) AS locked
    `
    const locked = rows[0]?.locked ?? false
    if (locked) {
      await reserved`SELECT pg_advisory_unlock(hashtextextended(${lockKey}, 0))`
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

  it('holds the lock while the callback runs', async () => {
    const lockKey = 'advisory-lock-test-hold'
    let heldDuringCallback: boolean | undefined

    await withAdvisoryLock(getTestSql(), lockKey, async () => {
      heldDuringCallback = await probeAdvisoryLock(lockKey)
    })

    expect(heldDuringCallback).toBe(false)
  })

  it('releases the lock after the callback completes', async () => {
    const lockKey = 'advisory-lock-test-release'

    await withAdvisoryLock(getTestSql(), lockKey, () => Promise.resolve())

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

describe('withAdvisoryLock (dead connection on unlock)', () => {
  // Fakes a connection whose second tagged-template call (the unlock) fails,
  // simulating a connection lost while fn() was running — the first call
  // (the lock) still succeeds.
  const buildSqlThatFailsToUnlock = (
    unlockError: Error = new Error('connection lost'),
  ): Sql => {
    let callCount = 0
    const reserved = Object.assign(
      () => {
        callCount += 1
        return callCount === 2
          ? Promise.reject(unlockError)
          : Promise.resolve([])
      },
      { release: vi.fn() },
    )
    const fakeSql = { reserve: () => Promise.resolve(reserved) }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal fake of postgres.Sql's reserve() surface; only .reserve() is ever called on this value.
    return fakeSql as unknown as Sql
  }

  it("surfaces the callback's error rather than a failing unlock", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      withAdvisoryLock(buildSqlThatFailsToUnlock(), 'key', () => {
        throw new Error('callback failed')
      }),
    ).rejects.toThrow('callback failed')
  })

  it("surfaces the callback's result even when the unlock afterward fails", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await withAdvisoryLock(
      buildSqlThatFailsToUnlock(),
      'key',
      () => Promise.resolve('done'),
    )

    expect(result).toBe('done')
  })

  it('reports the unlock failure to Sentry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unlockError = new Error('connection lost')

    await withAdvisoryLock(buildSqlThatFailsToUnlock(unlockError), 'key', () =>
      Promise.resolve('done'),
    )

    expect(Sentry.captureException).toHaveBeenCalledExactlyOnceWith(unlockError)
  })
})
