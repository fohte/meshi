import postgres from 'postgres'

export type Sql = postgres.Sql
export type SqlOrTx = Sql | postgres.TransactionSql<Record<string, never>>

export const createSql = (url: string): Sql => postgres(url)

export const pingDb = async (sql: Sql): Promise<void> => {
  await sql`SELECT 1`
}

// The `text` type's OID.
const TEXT_OID = 25

// Binds string parameters as explicit text (OID 25) for raw SQL queries.
export const createAsText =
  (sql: Sql) =>
  (value: string): postgres.Parameter<string> =>
    sql.typed(value, TEXT_OID)
