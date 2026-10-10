import postgres from 'postgres'

export type Sql = postgres.Sql
export type SqlOrTx = Sql | postgres.TransactionSql<Record<string, never>>

export const createSql = (url: string): Sql => postgres(url)

export const pingDb = async (sql: Sql): Promise<void> => {
  await sql`SELECT 1`
}

// The `text` type's OID.
const TEXT_OID = 25

// Drizzle changes the date serializer on postgres.js's shared options object,
// so raw SQL must carry the intended wire type explicitly.
export const createAsText =
  (sql: Sql) =>
  (value: string): postgres.Parameter<string> =>
    sql.typed(value, TEXT_OID)
