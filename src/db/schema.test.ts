import { expect, it } from 'vitest'

import { describeIfDb, getTestSql, setupTx } from '#test/db'
import {
  seedFoodComposition,
  seedFoodMasterWithoutNutrition,
  seedMealSet,
  seedStockLot,
} from '#test/seed'

describeIfDb('schema migrations', () => {
  it('creates the expected tables', async () => {
    const sql = getTestSql()
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
      'food_master_nutrition',
      'food_masters',
      'meal_logs',
      'meal_set_items',
      'meal_sets',
      'meal_skips',
      'nutrient_definitions',
      'stock_items',
      'stock_lots',
      'stock_movements',
      'storage_locations',
      'user_profiles',
    ])
  })

  it('creates the food_source, nutrient_unit, and meal_type enums with expected values', async () => {
    const sql = getTestSql()
    const rows = await sql<{ typname: string; labels: string[] }[]>`
      SELECT t.typname,
             array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN ('a2a_task_state', 'food_source', 'nutrient_unit', 'meal_type')
      GROUP BY t.typname
      ORDER BY t.typname
    `
    expect(rows).toEqual([
      {
        typname: 'food_source',
        labels: [
          'web_search',
          'composition_table_estimate',
          'user_input',
          'model_estimate',
        ],
      },
      {
        typname: 'meal_type',
        labels: ['breakfast', 'lunch', 'dinner', 'snack'],
      },
      { typname: 'nutrient_unit', labels: ['kcal', 'g', 'mg', 'µg'] },
    ])
  })

  it('removes the LangGraph checkpoint schema', async () => {
    const sql = getTestSql()
    const rows = await sql<{ schema_name: string }[]>`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = 'langgraph'
    `
    expect(rows).toEqual([])
  })

  it('installs the pg_trgm extension', async () => {
    const sql = getTestSql()
    const rows = await sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'
    `
    expect(rows).toEqual([{ extname: 'pg_trgm' }])
  })

  it('creates primary keys on nutrition and meal-set item tables', async () => {
    const sql = getTestSql()
    const rows = await sql<{ table_name: string; columns: string[] }[]>`
      SELECT c.conrelid::regclass::text AS table_name,
             array_agg(a.attname ORDER BY u.ord) AS columns
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
      WHERE c.contype = 'p'
        AND c.conrelid::regclass::text IN
        (
          'food_master_nutrients',
          'food_master_nutrition',
          'food_composition_nutrients',
          'meal_set_items'
        )
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
      {
        table_name: 'food_master_nutrition',
        columns: ['food_master_id'],
      },
      {
        table_name: 'meal_set_items',
        columns: ['meal_set_id', 'food_master_id'],
      },
    ])
  })

  it('creates indexes on food_master_nutrition metadata', async () => {
    const sql = getTestSql()
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN (
        'food_master_nutrition_is_estimated_idx',
        'food_master_nutrition_source_composition_code_idx'
      )
      ORDER BY indexname
    `
    expect(rows).toEqual([
      {
        indexname: 'food_master_nutrition_is_estimated_idx',
        indexdef:
          'CREATE INDEX food_master_nutrition_is_estimated_idx ON public.food_master_nutrition USING btree (is_estimated) WHERE (is_estimated = true)',
      },
      {
        indexname: 'food_master_nutrition_source_composition_code_idx',
        indexdef:
          'CREATE INDEX food_master_nutrition_source_composition_code_idx ON public.food_master_nutrition USING btree (source_composition_code)',
      },
    ])
  })

  it('creates the partial index on nutrient_definitions(is_major, sort_order)', async () => {
    const sql = getTestSql()
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

  it('indexes every stock foreign key column', async () => {
    const sql = getTestSql()
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN (
        'stock_items_pkey',
        'stock_items_storage_location_id_idx',
        'stock_lots_food_master_id_received_date_idx',
        'stock_movements_stock_lot_id_idx'
      )
      ORDER BY indexname
    `
    expect(rows).toEqual([
      {
        indexname: 'stock_items_pkey',
        indexdef:
          'CREATE UNIQUE INDEX stock_items_pkey ON public.stock_items USING btree (food_master_id)',
      },
      {
        indexname: 'stock_items_storage_location_id_idx',
        indexdef:
          'CREATE INDEX stock_items_storage_location_id_idx ON public.stock_items USING btree (storage_location_id)',
      },
      {
        indexname: 'stock_lots_food_master_id_received_date_idx',
        indexdef:
          'CREATE INDEX stock_lots_food_master_id_received_date_idx ON public.stock_lots USING btree (food_master_id, received_date)',
      },
      {
        indexname: 'stock_movements_stock_lot_id_idx',
        indexdef:
          'CREATE INDEX stock_movements_stock_lot_id_idx ON public.stock_movements USING btree (stock_lot_id)',
      },
    ])
  })

  it('creates meal-set name and food lookup indexes', async () => {
    const sql = getTestSql()
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN (
        'meal_sets_name_key',
        'meal_set_items_food_master_id_idx'
      )
      ORDER BY indexname
    `
    expect(rows).toEqual([
      {
        indexname: 'meal_set_items_food_master_id_idx',
        indexdef:
          'CREATE INDEX meal_set_items_food_master_id_idx ON public.meal_set_items USING btree (food_master_id)',
      },
      {
        indexname: 'meal_sets_name_key',
        indexdef:
          'CREATE UNIQUE INDEX meal_sets_name_key ON public.meal_sets USING btree (name)',
      },
    ])
  })

  it('creates GIN trigram indexes on the fuzzy-searchable text columns', async () => {
    const sql = getTestSql()
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE indexname IN (
        'food_masters_name_trgm_idx',
        'food_master_aliases_alias_trgm_idx',
        'food_compositions_name_trgm_idx',
        'meal_sets_name_trgm_idx'
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
      {
        indexname: 'meal_sets_name_trgm_idx',
        indexdef:
          'CREATE INDEX meal_sets_name_trgm_idx ON public.meal_sets USING gin (name gin_trgm_ops)',
      },
    ])
  })

  it('creates foreign keys with the expected ON UPDATE / ON DELETE actions', async () => {
    const sql = getTestSql()
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
        ref_table: 'food_master_nutrition',
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
        conname: 'food_master_nutrition_food_master_id_fk',
        table_name: 'food_master_nutrition',
        ref_table: 'food_masters',
        on_update: 'c',
        on_delete: 'c',
      },
      {
        conname: 'food_master_nutrition_source_composition_code_fk',
        table_name: 'food_master_nutrition',
        ref_table: 'food_compositions',
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
      {
        conname: 'meal_set_items_food_master_id_fk',
        table_name: 'meal_set_items',
        ref_table: 'food_masters',
        on_update: 'c',
        on_delete: 'r',
      },
      {
        conname: 'meal_set_items_meal_set_id_fk',
        table_name: 'meal_set_items',
        ref_table: 'meal_sets',
        on_update: 'c',
        on_delete: 'c',
      },
      {
        conname: 'stock_items_food_master_id_fk',
        table_name: 'stock_items',
        ref_table: 'food_masters',
        on_update: 'c',
        on_delete: 'c',
      },
      {
        conname: 'stock_items_storage_location_id_fk',
        table_name: 'stock_items',
        ref_table: 'storage_locations',
        on_update: 'c',
        on_delete: 'n',
      },
      {
        conname: 'stock_lots_food_master_id_fk',
        table_name: 'stock_lots',
        ref_table: 'food_masters',
        on_update: 'c',
        on_delete: 'r',
      },
      {
        conname: 'stock_movements_stock_lot_id_fk',
        table_name: 'stock_movements',
        ref_table: 'stock_lots',
        on_update: 'c',
        on_delete: 'r',
      },
    ])
  })

  it('creates the expected CHECK constraints', async () => {
    const sql = getTestSql()
    const rows = await sql<
      { conname: string; table_name: string; validated: boolean }[]
    >`
      SELECT c.conname,
             c.conrelid::regclass::text AS table_name,
             c.convalidated AS validated
      FROM pg_constraint c
      WHERE c.contype = 'c'
        AND c.connamespace = 'public'::regnamespace
      ORDER BY c.conname
    `
    expect(rows).toEqual([
      {
        conname: 'food_composition_nutrients_value_nonneg',
        table_name: 'food_composition_nutrients',
        validated: true,
      },
      {
        conname: 'food_master_nutrients_value_nonneg',
        table_name: 'food_master_nutrients',
        validated: true,
      },
      {
        conname: 'food_master_nutrition_composition_evidence',
        table_name: 'food_master_nutrition',
        validated: false,
      },
      {
        conname: 'food_master_nutrition_model_estimate_evidence',
        table_name: 'food_master_nutrition',
        validated: true,
      },
      {
        conname: 'food_master_nutrition_user_input_evidence',
        table_name: 'food_master_nutrition',
        validated: false,
      },
      {
        conname: 'food_master_nutrition_web_search_evidence',
        table_name: 'food_master_nutrition',
        validated: false,
      },
      {
        conname: 'meal_logs_quantity_positive',
        table_name: 'meal_logs',
        validated: true,
      },
      {
        conname: 'meal_set_items_quantity_positive',
        table_name: 'meal_set_items',
        validated: true,
      },
      {
        conname: 'meal_sets_name_nonblank',
        table_name: 'meal_sets',
        validated: true,
      },
      {
        conname: 'stock_items_eat_within_days_positive',
        table_name: 'stock_items',
        validated: true,
      },
      {
        conname: 'stock_lots_quantity_positive',
        table_name: 'stock_lots',
        validated: true,
      },
      {
        conname: 'stock_movements_delta_nonzero',
        table_name: 'stock_movements',
        validated: true,
      },
      {
        conname: 'stock_movements_reason_valid',
        table_name: 'stock_movements',
        validated: true,
      },
      {
        conname: 'storage_locations_capacity_positive',
        table_name: 'storage_locations',
        validated: true,
      },
      {
        conname: 'user_profiles_daily_targets_object',
        table_name: 'user_profiles',
        validated: true,
      },
      {
        conname: 'user_profiles_singleton',
        table_name: 'user_profiles',
        validated: true,
      },
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

describeIfDb('schema runtime constraints', () => {
  const getTx = setupTx()

  it('rejects inserts that violate the meal_logs_quantity_positive CHECK', async () => {
    const tx = getTx()
    await tx`
      INSERT INTO food_masters (id, name)
      VALUES ('fm_q', 'tofu')
    `
    expect(
      await runOutcome(tx`
        INSERT INTO meal_logs (id, food_master_id, eaten_date, meal_type, quantity)
        VALUES ('ml_q', 'fm_q', CURRENT_DATE, 'breakfast', 0)
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects blank meal-set names', async () => {
    const tx = getTx()
    expect(
      await runOutcome(tx`
        INSERT INTO meal_sets (id, name)
        VALUES ('ms_constraint_blank', '   ')
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects non-positive meal-set item quantities', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_constraint_quantity',
      name: 'constraint sample food',
    })
    await seedMealSet(tx, {
      id: 'ms_constraint_quantity',
      name: 'constraint sample set',
    })

    expect(
      await runOutcome(tx`
        INSERT INTO meal_set_items (meal_set_id, food_master_id, quantity)
        VALUES ('ms_constraint_quantity', 'fm_constraint_quantity', 0)
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects inserts that violate the food_master_nutrition_web_search_evidence CHECK (is_estimated=true)', async () => {
    const tx = getTx()
    await tx`INSERT INTO food_masters (id, name) VALUES ('fm_e', 'guessed')`
    expect(
      await runOutcome(tx`
        INSERT INTO food_master_nutrition (food_master_id, is_estimated, source, source_url)
        VALUES ('fm_e', true, 'web_search', 'https://example.com')
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects inserts that violate the food_master_nutrition_web_search_evidence CHECK (missing source_url)', async () => {
    const tx = getTx()
    await tx`INSERT INTO food_masters (id, name) VALUES ('fm_wse', 'guessed')`
    expect(
      await runOutcome(tx`
        INSERT INTO food_master_nutrition (food_master_id, is_estimated, source)
        VALUES ('fm_wse', false, 'web_search')
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects inserts that violate the food_master_nutrition_web_search_evidence CHECK (source_composition_code set)', async () => {
    const tx = getTx()
    await tx`INSERT INTO food_compositions (code, name) VALUES ('18008', 'カレールウ')`
    await tx`INSERT INTO food_masters (id, name) VALUES ('fm_wsc', 'guessed')`
    expect(
      await runOutcome(tx`
        INSERT INTO food_master_nutrition (food_master_id, is_estimated, source, source_url, source_composition_code)
        VALUES ('fm_wsc', false, 'web_search', 'https://example.com', '18008')
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects inserts that violate the food_master_nutrition_composition_evidence CHECK (missing source_composition_code)', async () => {
    const tx = getTx()
    await tx`INSERT INTO food_masters (id, name) VALUES ('fm_ce', 'unbacked')`
    expect(
      await runOutcome(tx`
        INSERT INTO food_master_nutrition (food_master_id, is_estimated, source)
        VALUES ('fm_ce', true, 'composition_table_estimate')
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects inserts that violate the food_master_nutrition_user_input_evidence CHECK (source_url set)', async () => {
    const tx = getTx()
    await tx`INSERT INTO food_masters (id, name) VALUES ('fm_uie', 'claimed')`
    expect(
      await runOutcome(tx`
        INSERT INTO food_master_nutrition (food_master_id, is_estimated, source, source_url)
        VALUES ('fm_uie', false, 'user_input', 'https://example.com')
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('accepts estimated model nutrition without source evidence', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_me',
      name: 'estimated',
    })
    expect(
      await runOutcome(tx`
        INSERT INTO food_master_nutrition (food_master_id, is_estimated, source)
        VALUES ('fm_me', true, 'model_estimate')
      `),
    ).toEqual({ status: 'ok' })
  })

  it('rejects model nutrition without is_estimated=true', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_mef',
      name: 'unestimated',
    })
    expect(
      await runOutcome(tx`
        INSERT INTO food_master_nutrition (food_master_id, is_estimated, source)
        VALUES ('fm_mef', false, 'model_estimate')
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects a source_url for model-estimated nutrition', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_meu',
      name: 'url evidence',
    })
    expect(
      await runOutcome(tx`
        INSERT INTO food_master_nutrition (food_master_id, is_estimated, source, source_url)
        VALUES ('fm_meu', true, 'model_estimate', 'https://example.test/item')
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects a source_composition_code for model-estimated nutrition', async () => {
    const tx = getTx()
    await seedFoodComposition(tx, {
      code: 'sample_composition_code',
      name: 'Sample composition',
    })
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_mec',
      name: 'composition evidence',
    })
    expect(
      await runOutcome(tx`
        INSERT INTO food_master_nutrition (food_master_id, is_estimated, source, source_composition_code)
        VALUES ('fm_mec', true, 'model_estimate', 'sample_composition_code')
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects negative nutrient values', async () => {
    const tx = getTx()
    await tx`
      INSERT INTO nutrient_definitions (code, display_name, unit)
      VALUES ('protein_g', 'protein', 'g')
    `
    await tx`
      INSERT INTO food_masters (id, name)
      VALUES ('fm_n', 'rice')
    `
    await tx`
      INSERT INTO food_master_nutrition (food_master_id, is_estimated, source)
      VALUES ('fm_n', false, 'user_input')
    `
    expect(
      await runOutcome(tx`
        INSERT INTO food_master_nutrients (food_master_id, nutrient_code, value)
        VALUES ('fm_n', 'protein_g', -1)
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects nutrient rows without food_master_nutrition metadata', async () => {
    const tx = getTx()
    await tx`
      INSERT INTO nutrient_definitions (code, display_name, unit)
      VALUES ('fiber_g', 'fiber', 'g')
    `
    await tx`
      INSERT INTO food_masters (id, name)
      VALUES ('fm_missing_nutrition', 'oats')
    `
    expect(
      await runOutcome(tx`
        INSERT INTO food_master_nutrients (food_master_id, nutrient_code, value)
        VALUES ('fm_missing_nutrition', 'fiber_g', 2)
      `),
    ).toEqual({ status: 'error', code: '23503' })
  })

  it('rejects user_profiles rows other than id = 1', async () => {
    const tx = getTx()
    expect(
      await runOutcome(tx`INSERT INTO user_profiles (id) VALUES (2)`),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects user_profiles.daily_targets that is not a jsonb object', async () => {
    const tx = getTx()
    expect(
      await runOutcome(tx`
        INSERT INTO user_profiles (id, daily_targets)
        VALUES (1, '[]'::jsonb)
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('forbids deleting a food_masters row referenced by a meal_log (FK RESTRICT)', async () => {
    const tx = getTx()
    await tx`
      INSERT INTO food_masters (id, name)
      VALUES ('fm_d', 'natto')
    `
    await tx`
      INSERT INTO meal_logs (id, food_master_id, eaten_date, meal_type, quantity)
      VALUES ('ml_d', 'fm_d', CURRENT_DATE, 'breakfast', 1)
    `
    expect(
      await runOutcome(tx`DELETE FROM food_masters WHERE id = 'fm_d'`),
    ).toEqual({ status: 'error', code: '23001' })
  })

  it('rejects nonpositive storage location capacity', async () => {
    const tx = getTx()
    expect(
      await runOutcome(tx`
        INSERT INTO storage_locations (id, name, capacity)
        VALUES ('sl_invalid_capacity', 'Sample storage', 0)
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects nonpositive stock item eat_within_days', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_invalid_eat_days',
      name: 'Sample food for invalid eat days',
    })
    expect(
      await runOutcome(tx`
        INSERT INTO stock_items (food_master_id, eat_within_days)
        VALUES ('fm_invalid_eat_days', 0)
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects nonpositive stock lot quantity', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_invalid_lot_quantity',
      name: 'Sample food for invalid lot quantity',
    })
    expect(
      await runOutcome(tx`
        INSERT INTO stock_lots (id, food_master_id, quantity)
        VALUES ('stl_invalid_quantity', 'fm_invalid_lot_quantity', 0)
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects zero stock movement delta', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_invalid_movement',
      name: 'Sample food for invalid movement',
    })
    await seedStockLot(tx, {
      id: 'stl_invalid_movement',
      foodMasterId: 'fm_invalid_movement',
      quantity: 1,
    })
    expect(
      await runOutcome(tx`
        INSERT INTO stock_movements (id, stock_lot_id, delta, reason)
        VALUES ('stm_zero_delta', 'stl_invalid_movement', 0, 'count')
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })

  it('rejects stock movement reasons outside the supported set', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_invalid_reason',
      name: 'Sample food for invalid reason',
    })
    await seedStockLot(tx, {
      id: 'stl_invalid_reason',
      foodMasterId: 'fm_invalid_reason',
      quantity: 1,
    })
    expect(
      await runOutcome(tx`
        INSERT INTO stock_movements (id, stock_lot_id, delta, reason)
        VALUES ('stm_invalid_reason', 'stl_invalid_reason', 1, 'correction')
      `),
    ).toEqual({ status: 'error', code: '23514' })
  })
})
