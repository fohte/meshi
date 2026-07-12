import type { Sql } from '@/db'

// pg_advisory_lock/unlock are scoped to the session (physical connection)
// that took the lock, not to a transaction, so this reserves a dedicated
// connection from the pool for the lock's lifetime and releases it back
// when done — the pool's normal round-robin connections would let the lock
// and unlock calls land on different backends, where the unlock would
// silently no-op and the lock would stay held until that connection closes.
export const withAdvisoryLock = async <T>(
  sql: Sql,
  lockKey: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const reserved = await sql.reserve()
  try {
    await reserved`SELECT pg_advisory_lock(hashtext(${lockKey}))`
    try {
      return await fn()
    } finally {
      await reserved`SELECT pg_advisory_unlock(hashtext(${lockKey}))`
    }
  } finally {
    reserved.release()
  }
}
