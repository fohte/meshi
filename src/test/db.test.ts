import { drizzle } from 'drizzle-orm/postgres-js'
import { describe, expect, it } from 'vitest'

import {
  captureSqlParams,
  describeIfDb,
  getTestSql,
  setupDrizzleTx,
} from '@/test/db'

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

describe('captureSqlParams', () => {
  it('captures tagged-template interpolations, passes through a non-tagged call, and unwraps .typed()', () => {
    const { sql, params } = captureSqlParams()
    const list = ['a', 'b']

    void sql`SELECT ${'x'}, ${sql.typed('y', 25)}, ${sql(list)}`

    expect(params).toEqual(['x', 'y', list])
  })
})
