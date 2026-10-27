import { ResultAsync } from 'neverthrow'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'

import migrationSetup from '#test/migration-global-setup'
import {
  type MigrationSnapshot,
  migrationSnapshotSchema,
} from '#test/migration-snapshot'

const databaseUrl = process.env['MIGRATION_TEST_DATABASE_URL']
const migrationTestSql =
  databaseUrl === undefined
    ? null
    : postgres(databaseUrl, { max: 1, onnotice: () => {} })
const describeIfDatabase = migrationTestSql === null ? describe.skip : describe

afterAll(async () => {
  if (migrationTestSql !== null) await migrationTestSql.end({ timeout: 5 })
})

const readSnapshot = async () => {
  if (migrationTestSql === null) {
    throw new Error('MIGRATION_TEST_DATABASE_URL is not set')
  }
  const rows = await migrationTestSql`
    SELECT value
    FROM migration_test.snapshots
    WHERE name = 'result'
  `
  return migrationSnapshotSchema.parse(rows[0]?.['value'])
}

const preservedData = (
  state: Awaited<ReturnType<typeof readSnapshot>>['before'],
) => ({
  nutrition_rows: state.nutrition_rows,
  meal_logs: state.meal_logs,
  stock_movements: state.stock_movements,
  daily_totals: state.daily_totals,
})

const rollbackOutput = (
  snapshot: Pick<
    MigrationSnapshot,
    'failed_migration_observed' | 'before' | 'rolled_back'
  >,
) => ({
  failed_migration_observed: snapshot.failed_migration_observed,
  before: snapshot.before,
  rolled_back: snapshot.rolled_back,
})

const migrationDetails = (
  snapshot: Pick<
    MigrationSnapshot,
    | 'version_assignments'
    | 'versions'
    | 'evidence_constraints'
    | 'change_record_count'
    | 'migration_count'
  >,
) => ({
  version_assignments: snapshot.version_assignments,
  versions: snapshot.versions,
  evidence_constraints: snapshot.evidence_constraints,
  change_record_count: snapshot.change_record_count,
  migration_count: snapshot.migration_count,
})

describeIfDatabase('nutrition version migration', () => {
  it('rejects a local database other than the migration-test database', async () => {
    const previousUrl = process.env['MIGRATION_TEST_DATABASE_URL']
    if (previousUrl === undefined) return

    const nonMigrationUrl = new URL(previousUrl)
    nonMigrationUrl.pathname = '/meshi_server_dev'
    let errorMessage: string
    try {
      process.env['MIGRATION_TEST_DATABASE_URL'] = nonMigrationUrl.toString()
      const setupResult = await ResultAsync.fromPromise(
        migrationSetup(),
        (error: unknown) => error,
      )
      errorMessage = setupResult.match(
        () => 'database was accepted',
        (error) => (error instanceof Error ? error.message : String(error)),
      )
    } finally {
      process.env['MIGRATION_TEST_DATABASE_URL'] = previousUrl
    }

    expect(errorMessage).toEqual(
      'MIGRATION_TEST_DATABASE_URL must target meshi_server_migration_test (got database: meshi_server_dev)',
    )
  })

  it('rolls back schema and data when a later migration fails', async () => {
    const snapshot = await readSnapshot()

    expect(rollbackOutput(snapshot)).toEqual(
      rollbackOutput({
        failed_migration_observed: true,
        before: snapshot.before,
        rolled_back: snapshot.before,
      }),
    )
  })

  it('preserves nutrition, meal logs, stock movements, and daily totals', async () => {
    const snapshot = await readSnapshot()
    expect(preservedData(snapshot.after)).toEqual(
      preservedData(snapshot.before),
    )
  })

  it('assigns migrated logs to v1 and validates legacy evidence checks', async () => {
    const snapshot = await readSnapshot()

    const expected = {
      version_assignments: [
        {
          id: 'legacy-log-composition',
          food_master_id: 'legacy-composition',
          version_food_master_id: 'legacy-composition',
          version_no: 1,
          origin: 'migrated',
        },
        {
          id: 'legacy-log-model',
          food_master_id: 'legacy-model',
          version_food_master_id: 'legacy-model',
          version_no: 1,
          origin: 'migrated',
        },
        {
          id: 'legacy-log-unknown',
          food_master_id: 'legacy-unknown',
          version_food_master_id: null,
          version_no: null,
          origin: 'migrated',
        },
        {
          id: 'legacy-log-user',
          food_master_id: 'legacy-user',
          version_food_master_id: 'legacy-user',
          version_no: 1,
          origin: 'migrated',
        },
        {
          id: 'legacy-log-valid',
          food_master_id: 'legacy-valid',
          version_food_master_id: 'legacy-valid',
          version_no: 1,
          origin: 'migrated',
        },
        {
          id: 'legacy-log-web',
          food_master_id: 'legacy-web',
          version_food_master_id: 'legacy-web',
          version_no: 1,
          origin: 'migrated',
        },
      ],
      versions: [
        {
          food_master_id: 'legacy-composition',
          version_no: 1,
          is_current: true,
          change_kind: 'initial',
          checked_on: null,
          effective_from: null,
          serving_basis: null,
          net_content: null,
          legacy_evidence: true,
        },
        {
          food_master_id: 'legacy-model',
          version_no: 1,
          is_current: true,
          change_kind: 'initial',
          checked_on: null,
          effective_from: null,
          serving_basis: null,
          net_content: null,
          legacy_evidence: true,
        },
        {
          food_master_id: 'legacy-user',
          version_no: 1,
          is_current: true,
          change_kind: 'initial',
          checked_on: null,
          effective_from: null,
          serving_basis: null,
          net_content: null,
          legacy_evidence: true,
        },
        {
          food_master_id: 'legacy-valid',
          version_no: 1,
          is_current: true,
          change_kind: 'initial',
          checked_on: null,
          effective_from: null,
          serving_basis: null,
          net_content: null,
          legacy_evidence: false,
        },
        {
          food_master_id: 'legacy-web',
          version_no: 1,
          is_current: true,
          change_kind: 'initial',
          checked_on: null,
          effective_from: null,
          serving_basis: null,
          net_content: null,
          legacy_evidence: true,
        },
      ],
      evidence_constraints: [
        {
          name: 'food_master_nutrition_composition_evidence',
          is_validated: true,
        },
        {
          name: 'food_master_nutrition_model_estimate_evidence',
          is_validated: true,
        },
        {
          name: 'food_master_nutrition_user_input_evidence',
          is_validated: true,
        },
        {
          name: 'food_master_nutrition_web_search_evidence',
          is_validated: true,
        },
      ],
      change_record_count: 0,
      migration_count: snapshot.before.migrations.length + 2,
    }
    expect(migrationDetails(snapshot)).toEqual(migrationDetails(expected))
  })
})
