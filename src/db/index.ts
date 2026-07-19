import postgres from 'postgres'

export type Sql = postgres.Sql
export type SqlOrTx = Sql | postgres.TransactionSql<Record<string, never>>
export type JsonValue = postgres.JSONValue

export const createSql = (url: string): Sql => postgres(url)

export const pingDb = async (sql: Sql): Promise<void> => {
  await sql`SELECT 1`
}

// The `text` type's OID.
const TEXT_OID = 25

// Binds `value` as an explicit text parameter instead of leaving
// postgres.js to infer a wire type for it — see the comment in
// src/a2a/postgres-task-store.ts for why any raw-SQL store sharing a
// connection pool with a drizzle()-backed repository needs this.
export const createAsText =
  (sql: Sql) =>
  (value: string): postgres.Parameter<string> =>
    sql.typed(value, TEXT_OID)
