import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runMigrations } from '@/db/migrate'

const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL']

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

if (TEST_DATABASE_URL !== undefined) {
  const host = new URL(TEST_DATABASE_URL).hostname
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `TEST_DATABASE_URL must point at a local Postgres (got host: ${host}); ` +
        `these tests run DROP SCHEMA CASCADE`,
    )
  }
}

const describeIfDb = TEST_DATABASE_URL === undefined ? describe.skip : describe

describeIfDb('schema migrations', () => {
  let sql: postgres.Sql

  beforeAll(async () => {
    sql = postgres(TEST_DATABASE_URL ?? '', { max: 4, onnotice: () => {} })
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE')
    await sql.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await sql.unsafe('CREATE SCHEMA public')
    await runMigrations(sql)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('creates the expected tables', async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `
    expect(rows.map((r) => r.table_name)).toEqual([
      'food_composition_nutrients',
      'food_compositions',
      'food_master_aliases',
      'food_master_nutrients',
      'food_masters',
      'meal_logs',
      'nutrient_definitions',
      'user_profiles',
    ])
  })

  it('creates the food_source and nutrient_unit enums with expected values', async () => {
    const rows = await sql<{ typname: string; labels: string[] }[]>`
      SELECT t.typname,
             array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN ('food_source', 'nutrient_unit')
      GROUP BY t.typname
      ORDER BY t.typname
    `
    expect(rows).toEqual([
      {
        typname: 'food_source',
        labels: ['web_search', 'composition_table_estimate', 'user_input'],
      },
      { typname: 'nutrient_unit', labels: ['kcal', 'g', 'mg', 'µg'] },
    ])
  })

  it('installs the pg_trgm extension', async () => {
    const rows = await sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'
    `
    expect(rows).toEqual([{ extname: 'pg_trgm' }])
  })

  it('creates composite primary keys on the *_nutrients tables', async () => {
    const rows = await sql<{ table_name: string; columns: string[] }[]>`
      SELECT c.conrelid::regclass::text AS table_name,
             array_agg(a.attname ORDER BY u.ord) AS columns
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
      WHERE c.contype = 'p'
        AND c.conrelid::regclass::text IN
          ('food_master_nutrients', 'food_composition_nutrients')
      GROUP BY c.conrelid
      ORDER BY table_name
    `
    expect(rows).toEqual([
      {
        table_name: 'food_composition_nutrients',
        columns: ['food_composition_code', 'nutrient_code'],
      },
      {
        table_name: 'food_master_nutrients',
        columns: ['food_master_id', 'nutrient_code'],
      },
    ])
  })

  it('creates the partial index on food_masters.is_estimated', async () => {
    const rows = await sql<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'food_masters_is_estimated_idx'
    `
    expect(rows).toEqual([
      {
        indexdef:
          'CREATE INDEX food_masters_is_estimated_idx ON public.food_masters USING btree (is_estimated) WHERE (is_estimated = true)',
      },
    ])
  })

  it('creates the partial index on nutrient_definitions(is_major, sort_order)', async () => {
    const rows = await sql<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'nutrient_definitions_major_sort_idx'
    `
    expect(rows).toEqual([
      {
        indexdef:
          'CREATE INDEX nutrient_definitions_major_sort_idx ON public.nutrient_definitions USING btree (is_major, sort_order) WHERE (is_major = true)',
      },
    ])
  })

  it('creates GIN trigram indexes on the fuzzy-searchable text columns', async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN (
        'food_masters_name_trgm_idx',
        'food_master_aliases_alias_trgm_idx',
        'food_compositions_name_trgm_idx'
      )
      ORDER BY indexname
    `
    expect(rows).toEqual([
      {
        indexname: 'food_compositions_name_trgm_idx',
        indexdef:
          'CREATE INDEX food_compositions_name_trgm_idx ON public.food_compositions USING gin (name gin_trgm_ops)',
      },
      {
        indexname: 'food_master_aliases_alias_trgm_idx',
        indexdef:
          'CREATE INDEX food_master_aliases_alias_trgm_idx ON public.food_master_aliases USING gin (alias gin_trgm_ops)',
      },
      {
        indexname: 'food_masters_name_trgm_idx',
        indexdef:
          'CREATE INDEX food_masters_name_trgm_idx ON public.food_masters USING gin (name gin_trgm_ops)',
      },
    ])
  })

  it('creates foreign keys with the expected ON UPDATE / ON DELETE actions', async () => {
    const rows = await sql<
      {
        conname: string
        table_name: string
        ref_table: string
        on_update: string
        on_delete: string
      }[]
    >`
      SELECT c.conname,
             c.conrelid::regclass::text AS table_name,
             c.confrelid::regclass::text AS ref_table,
             c.confupdtype AS on_update,
             c.confdeltype AS on_delete
      FROM pg_constraint c
      WHERE c.contype = 'f'
        AND c.connamespace = 'public'::regnamespace
      ORDER BY c.conname
    `
    expect(rows).toEqual([
      {
        conname: 'food_composition_nutrients_food_composition_code_fk',
        table_name: 'food_composition_nutrients',
        ref_table: 'food_compositions',
        on_update: 'c',
        on_delete: 'c',
      },
      {
        conname: 'food_composition_nutrients_nutrient_code_fk',
        table_name: 'food_composition_nutrients',
        ref_table: 'nutrient_definitions',
        on_update: 'c',
        on_delete: 'r',
      },
      {
        conname: 'food_master_aliases_food_master_id_fk',
        table_name: 'food_master_aliases',
        ref_table: 'food_masters',
        on_update: 'c',
        on_delete: 'c',
      },
      {
        conname: 'food_master_nutrients_food_master_id_fk',
        table_name: 'food_master_nutrients',
        ref_table: 'food_masters',
        on_update: 'c',
        on_delete: 'c',
      },
      {
        conname: 'food_master_nutrients_nutrient_code_fk',
        table_name: 'food_master_nutrients',
        ref_table: 'nutrient_definitions',
        on_update: 'c',
        on_delete: 'r',
      },
      {
        conname: 'meal_logs_food_master_id_fk',
        table_name: 'meal_logs',
        ref_table: 'food_masters',
        on_update: 'c',
        on_delete: 'r',
      },
    ])
  })

  it('creates the expected CHECK constraints', async () => {
    const rows = await sql<{ conname: string; table_name: string }[]>`
      SELECT c.conname,
             c.conrelid::regclass::text AS table_name
      FROM pg_constraint c
      WHERE c.contype = 'c'
        AND c.connamespace = 'public'::regnamespace
      ORDER BY c.conname
    `
    expect(rows).toEqual([
      {
        conname: 'food_composition_nutrients_value_nonneg',
        table_name: 'food_composition_nutrients',
      },
      {
        conname: 'food_master_nutrients_value_nonneg',
        table_name: 'food_master_nutrients',
      },
      {
        conname: 'food_masters_estimated_not_web_search',
        table_name: 'food_masters',
      },
      { conname: 'meal_logs_quantity_positive', table_name: 'meal_logs' },
      {
        conname: 'user_profiles_daily_targets_object',
        table_name: 'user_profiles',
      },
      { conname: 'user_profiles_singleton', table_name: 'user_profiles' },
    ])
  })
})

const runOutcome = async (
  promise: Promise<unknown>,
): Promise<{ status: 'ok' } | { status: 'error'; code: string | undefined }> =>
  promise
    .then(() => ({ status: 'ok' }) as const)
    .catch((err: unknown) => {
      const code =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        typeof err.code === 'string'
          ? err.code
          : undefined
      return { status: 'error', code } as const
    })

const truncate = async (sql: postgres.Sql): Promise<void> => {
  await sql.unsafe(
    'TRUNCATE meal_logs, food_master_aliases, food_master_nutrients, ' +
      'food_composition_nutrients, food_compositions, food_masters, ' +
      'nutrient_definitions, user_profiles RESTART IDENTITY CASCADE',
  )
}

describeIfDb('schema runtime constraints', () => {
  let sql: postgres.Sql

  beforeAll(() => {
    sql = postgres(TEST_DATABASE_URL ?? '', { max: 4, onnotice: () => {} })
  })

  afterAll(async () => {
    await truncate(sql)
    await sql.end({ timeout: 5 })
  })

  it('rejects inserts that violate the meal_logs_quantity_positive CHECK', async () => {
    await truncate(sql)
    await sql`
      INSERT INTO food_masters (id, name, source)
      VALUES ('fm_q', 'tofu', 'user_input')
    `
    expect(
      await runOutcome(sql`
        INSERT INTO meal_logs (id, food_master_id, eaten_at, quantity, unit)
        VALUES ('ml_q', 'fm_q', now(), 0, 'g')
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects inserts that violate the food_masters_estimated_not_web_search CHECK', async () => {
    await truncate(sql)
    expect(
      await runOutcome(sql`
        INSERT INTO food_masters (id, name, is_estimated, source)
        VALUES ('fm_e', 'guessed', true, 'web_search')
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects negative nutrient values', async () => {
    await truncate(sql)
    await sql`
      INSERT INTO nutrient_definitions (code, display_name, unit)
      VALUES ('protein_g', 'protein', 'g')
    `
    await sql`
      INSERT INTO food_masters (id, name, source)
      VALUES ('fm_n', 'rice', 'user_input')
    `
    expect(
      await runOutcome(sql`
        INSERT INTO food_master_nutrients (food_master_id, nutrient_code, value)
        VALUES ('fm_n', 'protein_g', -1)
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects user_profiles rows other than id = 1', async () => {
    await truncate(sql)
    expect(
      await runOutcome(sql`INSERT INTO user_profiles (id) VALUES (2)`),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects user_profiles.daily_targets that is not a jsonb object', async () => {
    await truncate(sql)
    expect(
      await runOutcome(sql`
        INSERT INTO user_profiles (id, daily_targets)
        VALUES (1, '[]'::jsonb)
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('forbids deleting a food_masters row referenced by a meal_log (FK RESTRICT)', async () => {
    await truncate(sql)
    await sql`
      INSERT INTO food_masters (id, name, source)
      VALUES ('fm_d', 'natto', 'user_input')
    `
    await sql`
      INSERT INTO meal_logs (id, food_master_id, eaten_at, quantity, unit)
      VALUES ('ml_d', 'fm_d', now(), 1, 'パック')
    `
    expect(
      await runOutcome(sql`DELETE FROM food_masters WHERE id = 'fm_d'`),
    ).toEqual({ status: 'error', code: '23503' })
  })
})
