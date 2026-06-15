import postgres from 'postgres'

export type Sql = postgres.Sql

export const createSql = (url: string): Sql => postgres(url)

export const pingDb = async (sql: Sql): Promise<void> => {
  await sql`SELECT 1`
}
