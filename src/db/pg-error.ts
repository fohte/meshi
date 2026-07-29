const PG_UNIQUE_VIOLATION = '23505'
const PG_FOREIGN_KEY_VIOLATION = '23503'

interface PgErrorShape {
  readonly code?: string
  readonly constraint_name?: string
}

// postgres.js errors sometimes arrive wrapped (e.g. inside a savepoint
// rollback rejection), so this walks `.cause` chains to find the actual
// Postgres error code.
export const findPostgresError = (err: unknown): PgErrorShape | undefined => {
  let current: unknown = err
  while (typeof current === 'object' && current !== null) {
    if ('code' in current && typeof current.code === 'string') {
      const shape: PgErrorShape = { code: current.code }
      if (
        'constraint_name' in current &&
        typeof current.constraint_name === 'string'
      ) {
        return { ...shape, constraint_name: current.constraint_name }
      }
      return shape
    }
    if ('cause' in current) {
      current = current.cause
      continue
    }
    return undefined
  }
  return undefined
}

export const isUniqueViolation = (err: unknown): boolean =>
  findPostgresError(err)?.code === PG_UNIQUE_VIOLATION

export const isForeignKeyViolation = (err: unknown): boolean =>
  findPostgresError(err)?.code === PG_FOREIGN_KEY_VIOLATION

export const getConstraintName = (err: unknown): string | undefined =>
  findPostgresError(err)?.constraint_name
