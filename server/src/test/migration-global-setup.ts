import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { ResultAsync } from 'neverthrow'
import postgres from 'postgres'
import { z } from 'zod'

import { migrationSnapshotSchema } from '#test/migration-snapshot'

const migrationEntrySchema = z.object({
  idx: z.number().int(),
  version: z.string(),
  when: z.number(),
  tag: z.string(),
  breakpoints: z.boolean(),
})

const migrationJournalSchema = z.object({
  version: z.string(),
  dialect: z.literal('postgresql'),
  entries: z.array(migrationEntrySchema).min(1),
})

const fixtureFoods = [
  { id: 'legacy-valid', name: 'Legacy valid food' },
  { id: 'legacy-web', name: 'Legacy web source food' },
  { id: 'legacy-composition', name: 'Legacy composition food' },
  { id: 'legacy-user', name: 'Legacy user source food' },
  { id: 'legacy-model', name: 'Legacy model source food' },
  { id: 'legacy-unknown', name: 'Legacy unknown food' },
] as const
const nutritionVersionsMigrationCount = 2

const databaseUrlSchema = z.url()

const createMigrationFolder = async (
  root: string,
  name: string,
  sourceFolder: string,
  journal: z.infer<typeof migrationJournalSchema>,
  lastIndex: number,
  appendFailure: boolean,
): Promise<string> => {
  const folder = path.join(root, name)
  await mkdir(folder)
  const metadataFolder = path.join(folder, 'meta')
  await mkdir(metadataFolder)
  const entries = journal.entries.filter((entry) => entry.idx <= lastIndex)

  for (const entry of entries) {
    await copyFile(
      path.join(sourceFolder, `${entry.tag}.sql`),
      path.join(folder, `${entry.tag}.sql`),
    )
  }

  if (appendFailure) {
    const latestEntry = entries.at(-1)
    const failureEntry = migrationEntrySchema.parse({
      idx: (latestEntry?.idx ?? -1) + 1,
      version: journal.version,
      when: (latestEntry?.when ?? 0) + 1,
      tag: `migration_test_failure_${String((latestEntry?.idx ?? -1) + 1)}`,
      breakpoints: true,
    })
    entries.push(failureEntry)
    await writeFile(
      path.join(folder, `${failureEntry.tag}.sql`),
      "SELECT 'intentional migration test failure'::integer;\n",
    )
  }

  await writeFile(
    path.join(metadataFolder, '_journal.json'),
    JSON.stringify({ ...journal, entries }, null, 2),
  )
  return folder
}

const insertLegacyFixture = async (sql: postgres.Sql): Promise<void> => {
  await sql`
    INSERT INTO food_masters (id, name)
    VALUES ${sql(fixtureFoods.map(({ id, name }) => [id, name]))}
  `
  await sql`
    INSERT INTO nutrient_definitions (code, display_name, unit, is_major, sort_order)
    VALUES
      ('energy_kcal', 'Energy', 'kcal', true, 0),
      ('protein_g', 'Protein', 'g', false, 1)
  `

  await sql`
    ALTER TABLE food_master_nutrition
      DROP CONSTRAINT food_master_nutrition_web_search_evidence,
      DROP CONSTRAINT food_master_nutrition_composition_evidence,
      DROP CONSTRAINT food_master_nutrition_user_input_evidence,
      DROP CONSTRAINT food_master_nutrition_model_estimate_evidence
  `
  await sql`
    INSERT INTO food_master_nutrition (
      food_master_id, is_estimated, source, source_url, source_composition_code
    )
    VALUES
      ('legacy-valid', false, 'web_search', 'https://example.invalid/food', null),
      ('legacy-web', true, 'web_search', null, null),
      ('legacy-composition', false, 'composition_table_estimate', null, null),
      ('legacy-user', false, 'user_input', 'https://example.invalid/legacy', null),
      ('legacy-model', false, 'model_estimate', null, null)
  `
  await sql`
    ALTER TABLE food_master_nutrition
      ADD CONSTRAINT food_master_nutrition_web_search_evidence CHECK (
        source <> 'web_search' OR (
          is_estimated = false AND source_url IS NOT NULL AND source_composition_code IS NULL
        )
      ) NOT VALID,
      ADD CONSTRAINT food_master_nutrition_composition_evidence CHECK (
        source <> 'composition_table_estimate' OR (
          is_estimated = true AND source_url IS NULL AND source_composition_code IS NOT NULL
        )
      ) NOT VALID,
      ADD CONSTRAINT food_master_nutrition_user_input_evidence CHECK (
        source <> 'user_input' OR (source_url IS NULL AND source_composition_code IS NULL)
      ) NOT VALID,
      ADD CONSTRAINT food_master_nutrition_model_estimate_evidence CHECK (
        source::text <> 'model_estimate' OR (
          is_estimated = true AND source_url IS NULL AND source_composition_code IS NULL
        )
      ) NOT VALID
  `
  await sql`
    INSERT INTO food_master_nutrients (food_master_id, nutrient_code, value)
    VALUES
      ('legacy-valid', 'energy_kcal', 100),
      ('legacy-valid', 'protein_g', 5),
      ('legacy-web', 'energy_kcal', 80),
      ('legacy-web', 'protein_g', 4),
      ('legacy-composition', 'energy_kcal', 60),
      ('legacy-composition', 'protein_g', 3),
      ('legacy-user', 'energy_kcal', 90),
      ('legacy-user', 'protein_g', 6),
      ('legacy-model', 'energy_kcal', 70),
      ('legacy-model', 'protein_g', 2)
  `
  await sql`
    INSERT INTO meal_logs (id, food_master_id, eaten_date, meal_type, quantity, created_at)
    VALUES
      ('legacy-log-valid', 'legacy-valid', '2026-10-20', 'breakfast', 2, '2026-10-20T01:00:00Z'),
      ('legacy-log-web', 'legacy-web', '2026-10-20', 'lunch', 0.5, '2026-10-20T02:00:00Z'),
      ('legacy-log-composition', 'legacy-composition', '2026-10-21', 'dinner', 1, '2026-10-21T03:00:00Z'),
      ('legacy-log-user', 'legacy-user', '2026-10-21', 'snack', 3, '2026-10-21T04:00:00Z'),
      ('legacy-log-model', 'legacy-model', '2026-10-22', 'breakfast', 1.5, '2026-10-22T05:00:00Z'),
      ('legacy-log-unknown', 'legacy-unknown', '2026-10-22', 'lunch', 1, '2026-10-22T06:00:00Z')
  `
  await sql`
    INSERT INTO stock_lots (id, food_master_id, quantity)
    VALUES ('legacy-stock-lot', 'legacy-valid', 5)
  `
  await sql`
    INSERT INTO stock_movements (
      id, stock_lot_id, delta, reason, note, meal_log_id, created_at
    )
    VALUES (
      'legacy-stock-movement', 'legacy-stock-lot', -2, 'meal', 'Recorded meal',
      'legacy-log-valid', '2026-10-20T01:01:00Z'
    )
  `
}

const capturePreservedState = async (sql: postgres.Sql, migrated: boolean) => {
  const columns = await sql`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'food_master_nutrition', 'food_master_nutrients', 'meal_logs',
        'meal_log_nutrition_changes'
      )
    ORDER BY table_name, ordinal_position
  `
  const constraints = await sql`
    SELECT
      con.conname AS name,
      relation.relname AS table_name,
      con.contype::text AS type,
      con.convalidated AS is_validated
    FROM pg_constraint AS con
    JOIN pg_class AS relation ON relation.oid = con.conrelid
    WHERE relation.relnamespace = 'public'::regnamespace
      AND relation.relname IN (
        'food_master_nutrition', 'food_master_nutrients', 'meal_logs',
        'meal_log_nutrition_changes'
      )
    ORDER BY relation.relname, con.conname
  `
  const migrations = await sql`
    SELECT hash, created_at::text
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at
  `
  const nutritionRows = migrated
    ? await sql`
        SELECT
          nutrition.food_master_id,
          nutrition.is_estimated,
          nutrition.source::text AS source,
          nutrition.source_url,
          nutrition.source_composition_code,
          nutrients.nutrient_code,
          nutrients.value::text AS value
        FROM food_master_nutrition AS nutrition
        JOIN food_master_nutrients AS nutrients
          ON nutrients.nutrition_version_id = nutrition.id
        ORDER BY nutrition.food_master_id, nutrients.nutrient_code
      `
    : await sql`
        SELECT
          nutrition.food_master_id,
          nutrition.is_estimated,
          nutrition.source::text AS source,
          nutrition.source_url,
          nutrition.source_composition_code,
          nutrients.nutrient_code,
          nutrients.value::text AS value
        FROM food_master_nutrition AS nutrition
        JOIN food_master_nutrients AS nutrients
          ON nutrients.food_master_id = nutrition.food_master_id
        ORDER BY nutrition.food_master_id, nutrients.nutrient_code
      `
  const mealLogs = await sql`
    SELECT id, food_master_id, eaten_date::text, meal_type::text, quantity::text, created_at::text
    FROM meal_logs
    ORDER BY id
  `
  const stockMovements = await sql`
    SELECT
      id,
      stock_lot_id,
      delta::text,
      reason,
      note,
      meal_log_id,
      created_at::text
    FROM stock_movements
    ORDER BY id
  `
  const dailyTotals = migrated
    ? await sql`
        SELECT
          logs.eaten_date::text,
          nutrients.nutrient_code,
          sum(logs.quantity * nutrients.value)::text AS value
        FROM meal_logs AS logs
        JOIN food_master_nutrients AS nutrients
          ON nutrients.nutrition_version_id = logs.nutrition_version_id
        GROUP BY logs.eaten_date, nutrients.nutrient_code
        ORDER BY logs.eaten_date, nutrients.nutrient_code
      `
    : await sql`
        SELECT
          logs.eaten_date::text,
          nutrients.nutrient_code,
          sum(logs.quantity * nutrients.value)::text AS value
        FROM meal_logs AS logs
        JOIN food_master_nutrients AS nutrients
          ON nutrients.food_master_id = logs.food_master_id
        GROUP BY logs.eaten_date, nutrients.nutrient_code
        ORDER BY logs.eaten_date, nutrients.nutrient_code
      `

  return {
    columns,
    constraints,
    migrations,
    nutrition_rows: nutritionRows,
    meal_logs: mealLogs,
    stock_movements: stockMovements,
    daily_totals: dailyTotals,
  }
}

const captureMigratedDetails = async (sql: postgres.Sql) => {
  const versionAssignments = await sql`
    SELECT
      logs.id,
      logs.food_master_id,
      nutrition.food_master_id AS version_food_master_id,
      nutrition.version_no,
      logs.nutrition_version_origin AS origin
    FROM meal_logs AS logs
    LEFT JOIN food_master_nutrition AS nutrition
      ON nutrition.id = logs.nutrition_version_id
    ORDER BY logs.id
  `
  const versions = await sql`
    SELECT
      food_master_id,
      version_no,
      is_current,
      change_kind,
      checked_on::text,
      effective_from::text,
      serving_basis,
      net_content,
      legacy_evidence
    FROM food_master_nutrition
    ORDER BY food_master_id, version_no
  `
  const evidenceConstraints = await sql`
    SELECT conname AS name, convalidated AS is_validated
    FROM pg_constraint
    WHERE conrelid = 'public.food_master_nutrition'::regclass
      AND conname IN (
        'food_master_nutrition_web_search_evidence',
        'food_master_nutrition_composition_evidence',
        'food_master_nutrition_user_input_evidence',
        'food_master_nutrition_model_estimate_evidence'
      )
    ORDER BY conname
  `
  const changeRecords = await sql`
    SELECT count(*)::int AS count FROM meal_log_nutrition_changes
  `
  const migrations = await sql`
    SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
  `

  return {
    version_assignments: versionAssignments,
    versions,
    evidence_constraints: evidenceConstraints,
    change_record_count: z.number().int().parse(changeRecords[0]?.['count']),
    migration_count: z.number().int().parse(migrations[0]?.['count']),
  }
}

const storeSnapshot = async (
  sql: postgres.Sql,
  snapshot: z.infer<typeof migrationSnapshotSchema>,
): Promise<void> => {
  await sql`
    INSERT INTO migration_test.snapshots (name, value)
    VALUES ('result', ${JSON.stringify(snapshot)}::jsonb)
  `
}

export default async function setup(): Promise<() => Promise<void> | void> {
  const rawDatabaseUrl = process.env['MIGRATION_TEST_DATABASE_URL']
  if (rawDatabaseUrl === undefined) return () => {}

  const parsedDatabaseUrl = databaseUrlSchema.safeParse(rawDatabaseUrl)
  if (!parsedDatabaseUrl.success) {
    // eslint-disable-next-line no-restricted-syntax -- Vitest globalSetup must throw so invalid test configuration fails the migration suite.
    throw new Error('MIGRATION_TEST_DATABASE_URL must be a valid Postgres URL')
  }
  const url = new URL(parsedDatabaseUrl.data)
  if (!new Set(['localhost', '127.0.0.1', '::1']).has(url.hostname)) {
    // eslint-disable-next-line no-restricted-syntax -- This setup drops schemas and is restricted to a disposable local database.
    throw new Error(
      `MIGRATION_TEST_DATABASE_URL must point at a local disposable Postgres (got host: ${url.hostname})`,
    )
  }
  if (url.pathname !== '/meshi_server_migration_test') {
    // eslint-disable-next-line no-restricted-syntax -- This setup drops schemas and is restricted to its dedicated database.
    throw new Error(
      `MIGRATION_TEST_DATABASE_URL must target meshi_server_migration_test (got database: ${url.pathname.slice(1)})`,
    )
  }

  const sql = postgres(parsedDatabaseUrl.data, { max: 1, onnotice: () => {} })
  const sourceFolder = fileURLToPath(new URL('../../drizzle/', import.meta.url))
  const migrationRoot = await mkdtemp(
    path.join(os.tmpdir(), 'meshi-migration-test-'),
  )
  let keepMigrationRoot = false

  // eslint-disable-next-line no-restricted-syntax -- The setup must close its database connection if any migration phase fails.
  try {
    const journal = migrationJournalSchema.parse(
      JSON.parse(
        await readFile(path.join(sourceFolder, 'meta/_journal.json'), 'utf8'),
      ),
    )
    const latestMigrationIndex = z
      .number()
      .int()
      .parse(journal.entries.at(-1)?.idx)
    const beforeFolder = await createMigrationFolder(
      migrationRoot,
      'before',
      sourceFolder,
      journal,
      latestMigrationIndex - nutritionVersionsMigrationCount,
      false,
    )
    const failingFolder = await createMigrationFolder(
      migrationRoot,
      'failing',
      sourceFolder,
      journal,
      latestMigrationIndex,
      true,
    )
    const finalFolder = await createMigrationFolder(
      migrationRoot,
      'final',
      sourceFolder,
      journal,
      latestMigrationIndex,
      false,
    )

    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE')
    await sql.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await sql.unsafe('DROP SCHEMA IF EXISTS langgraph CASCADE')
    await sql.unsafe('DROP SCHEMA IF EXISTS migration_test CASCADE')
    await sql.unsafe('CREATE SCHEMA public')
    await sql.unsafe('CREATE SCHEMA langgraph')
    await sql.unsafe('CREATE SCHEMA migration_test')
    await sql.unsafe(`
      CREATE TABLE migration_test.snapshots (
        name text PRIMARY KEY,
        value jsonb NOT NULL
      )
    `)

    await migrate(drizzle(sql), { migrationsFolder: beforeFolder })
    await insertLegacyFixture(sql)
    const before = await capturePreservedState(sql, false)

    const failingMigrationResult = await ResultAsync.fromPromise(
      migrate(drizzle(sql), { migrationsFolder: failingFolder }),
      (error: unknown) => error,
    )
    const failedMigrationObserved =
      failingMigrationResult.isErr() &&
      failingMigrationResult.error instanceof Error &&
      failingMigrationResult.error.message.includes(
        'intentional migration test failure',
      )
    const rolledBack = await capturePreservedState(sql, false)

    await migrate(drizzle(sql), { migrationsFolder: finalFolder })
    const after = await capturePreservedState(sql, true)
    const details = await captureMigratedDetails(sql)
    const migrationSnapshot = migrationSnapshotSchema.parse({
      before,
      rolled_back: rolledBack,
      after,
      failed_migration_observed: failedMigrationObserved,
      ...details,
    })
    await storeSnapshot(sql, migrationSnapshot)
    keepMigrationRoot = true
  } finally {
    await sql.end({ timeout: 5 })
    if (!keepMigrationRoot)
      await rm(migrationRoot, { recursive: true, force: true })
  }

  return async function teardown() {
    await rm(migrationRoot, { recursive: true, force: true })
  }
}
