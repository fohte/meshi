import type { Sql } from '#db/index'

// pg_advisory_lock/unlock are scoped to the session (physical connection)
// that took the lock, not to a transaction, so this reserves a dedicated
// connection from the pool for the lock's lifetime and releases it back
// when done — the pool's normal round-robin connections would let the lock
// and unlock calls land on different backends, where the unlock would
// silently no-op and the lock would stay held until that connection closes.
//
// Built on .then()/.catch()/.finally() rather than try/catch/finally
// statements (see src/domain/food-master/repository.ts's runInSavepoint for
// the same convention) so fn's own throw/rejection propagates through
// untouched while the lock/connection cleanup still always runs.
export const withAdvisoryLock = <T>(
  sql: Sql,
  lockKey: string,
  fn: () => Promise<T>,
): Promise<T> =>
  sql.reserve().then((reserved) =>
    // hashtextextended(text, seed) over hashtext(text): pg_advisory_lock
    // takes a bigint, and hashtext alone only fills the low 32 bits of it,
    // making unrelated lock keys collide (and serialize against each
    // other) far more often than the 64-bit hash needs to.
    reserved`SELECT pg_advisory_lock(hashtextextended(${lockKey}, 0))`
      .then(() =>
        // Routed through .then(fn) rather than calling fn() directly so a
        // synchronous throw from fn (it isn't required to be an async
        // function) becomes a rejected promise here too, and the .finally
        // cleanup below still runs for it — a bare fn() call would let a
        // synchronous throw skip .finally entirely.
        Promise.resolve()
          .then(fn)
          .finally(() =>
            // A connection lost while fn() was running already released the
            // advisory lock on the Postgres side; a failing unlock at that
            // point is expected, not a new problem — letting it reject here
            // would replace fn()'s own result or error with this secondary one.
            reserved`SELECT pg_advisory_unlock(hashtextextended(${lockKey}, 0))`.catch(
              (err: unknown) => {
                console.error('failed to release advisory lock:', err)
              },
            ),
          ),
      )
      .finally(() => {
        reserved.release()
      }),
  )
