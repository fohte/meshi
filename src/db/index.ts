import postgres from 'postgres'

export type Sql = postgres.Sql
export type SqlOrTx = Sql | postgres.TransactionSql<Record<string, never>>
export type JsonValue = postgres.JSONValue

export const createSql = (url: string): Sql => postgres(url)

export const pingDb = async (sql: Sql): Promise<void> => {
  await sql`SELECT 1`
}
