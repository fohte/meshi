import { drizzle } from 'drizzle-orm/postgres-js'
import { expect, it } from 'vitest'

import { describeIfDb, getTestSql, setupDrizzleTx } from '@/test/db'

describeIfDb('setupDrizzleTx', () => {
  const getTx = setupDrizzleTx()

  it("does not mutate the pool's shared type parsers for other connections", async () => {
    const tx = getTx()
    // Constructing drizzle() flips the timestamptz parser (oid 1184) to an
    // identity pass-through on whatever `.options` object `tx` was given.
    drizzle(tx)

    const sql = getTestSql()
    const [row] = await sql<{ now: Date }[]>`SELECT now() AS now`
    expect(row?.now).toBeInstanceOf(Date)
  })
})
