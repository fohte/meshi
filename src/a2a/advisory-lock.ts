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
    // hashtextextended(text, seed) over hashtext(text): pg_advisory_lock
    // takes a bigint, and hashtext alone only fills the low 32 bits of it,
    // making unrelated lock keys collide (and serialize against each
    // other) far more often than the 64-bit hash needs to.
    await reserved`SELECT pg_advisory_lock(hashtextextended(${lockKey}, 0))`
    try {
      return await fn()
    } finally {
      await reserved`SELECT pg_advisory_unlock(hashtextextended(${lockKey}, 0))`
    }
  } finally {
    reserved.release()
  }
}
