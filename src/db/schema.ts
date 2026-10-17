import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import type { JstDate } from '#lib/jst-date'

export const foodSourceEnum = pgEnum('food_source', [
  'web_search',
  'composition_table_estimate',
  'user_input',
  'model_estimate',
])

export const nutrientUnitEnum = pgEnum('nutrient_unit', [
  'kcal',
  'g',
  'mg',
  'µg',
])

export const mealTypeEnum = pgEnum('meal_type', [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
])

export const nutrientDefinitions = pgTable(
  'nutrient_definitions',
  {
    code: text('code').primaryKey(),
    displayName: text('display_name').notNull(),
    unit: nutrientUnitEnum('unit').notNull(),
    isMajor: boolean('is_major').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('nutrient_definitions_major_sort_idx')
      .on(table.isMajor, table.sortOrder)
      .where(sql`${table.isMajor} = true`),
  ],
)

export const foodMasters = pgTable(
  'food_masters',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('food_masters_name_key').on(table.name),
    index('food_masters_name_trgm_idx').using(
      'gin',
      sql`${table.name} gin_trgm_ops`,
    ),
  ],
)

export const mealSets = pgTable(
  'meal_sets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('meal_sets_name_key').on(table.name),
    index('meal_sets_name_trgm_idx').using(
      'gin',
      sql`${table.name} gin_trgm_ops`,
    ),
    check('meal_sets_name_nonblank', sql`btrim(${table.name}) <> ''`),
  ],
)

export const mealSetItems = pgTable(
  'meal_set_items',
  {
    mealSetId: text('meal_set_id').notNull(),
    foodMasterId: text('food_master_id').notNull(),
    quantity: numeric('quantity').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'meal_set_items_pkey',
      columns: [table.mealSetId, table.foodMasterId],
    }),
    foreignKey({
      name: 'meal_set_items_meal_set_id_fk',
      columns: [table.mealSetId],
      foreignColumns: [mealSets.id],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      name: 'meal_set_items_food_master_id_fk',
      columns: [table.foodMasterId],
      foreignColumns: [foodMasters.id],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    index('meal_set_items_food_master_id_idx').on(table.foodMasterId),
    check('meal_set_items_quantity_positive', sql`${table.quantity} > 0`),
  ],
)

export const foodMasterNutrition = pgTable(
  'food_master_nutrition',
  {
    foodMasterId: text('food_master_id').notNull(),
    isEstimated: boolean('is_estimated').notNull().default(false),
    source: foodSourceEnum('source').notNull(),
    sourceUrl: text('source_url'),
    sourceCompositionCode: text('source_composition_code'),
  },
  (table) => [
    primaryKey({
      name: 'food_master_nutrition_pkey',
      columns: [table.foodMasterId],
    }),
    foreignKey({
      name: 'food_master_nutrition_food_master_id_fk',
      columns: [table.foodMasterId],
      foreignColumns: [foodMasters.id],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      name: 'food_master_nutrition_source_composition_code_fk',
      columns: [table.sourceCompositionCode],
      foreignColumns: [foodCompositions.code],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    index('food_master_nutrition_is_estimated_idx')
      .on(table.isEstimated)
      .where(sql`${table.isEstimated} = true`),
    index('food_master_nutrition_source_composition_code_idx').on(
      table.sourceCompositionCode,
    ),
    // Migrations leave these checks NOT VALID because existing nutrition
    // metadata includes rows that predate the evidence requirement.
    check(
      'food_master_nutrition_web_search_evidence',
      sql`${table.source} <> 'web_search' OR (${table.isEstimated} = false AND ${table.sourceUrl} IS NOT NULL AND ${table.sourceCompositionCode} IS NULL)`,
    ),
    check(
      'food_master_nutrition_composition_evidence',
      sql`${table.source} <> 'composition_table_estimate' OR (${table.isEstimated} = true AND ${table.sourceUrl} IS NULL AND ${table.sourceCompositionCode} IS NOT NULL)`,
    ),
    check(
      'food_master_nutrition_user_input_evidence',
      sql`${table.source} <> 'user_input' OR (${table.sourceUrl} IS NULL AND ${table.sourceCompositionCode} IS NULL)`,
    ),
    check(
      'food_master_nutrition_model_estimate_evidence',
      sql`${table.source}::text <> 'model_estimate' OR (${table.isEstimated} = true AND ${table.sourceUrl} IS NULL AND ${table.sourceCompositionCode} IS NULL)`,
    ),
  ],
)

export const foodMasterAliases = pgTable(
  'food_master_aliases',
  {
    id: text('id').primaryKey(),
    foodMasterId: text('food_master_id').notNull(),
    alias: text('alias').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'food_master_aliases_food_master_id_fk',
      columns: [table.foodMasterId],
      foreignColumns: [foodMasters.id],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    uniqueIndex('food_master_aliases_alias_key').on(table.alias),
    index('food_master_aliases_food_master_id_idx').on(table.foodMasterId),
    index('food_master_aliases_alias_trgm_idx').using(
      'gin',
      sql`${table.alias} gin_trgm_ops`,
    ),
  ],
)

export const foodMasterNutrients = pgTable(
  'food_master_nutrients',
  {
    foodMasterId: text('food_master_id').notNull(),
    nutrientCode: text('nutrient_code').notNull(),
    value: numeric('value').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'food_master_nutrients_pkey',
      columns: [table.foodMasterId, table.nutrientCode],
    }),
    foreignKey({
      name: 'food_master_nutrients_food_master_id_fk',
      columns: [table.foodMasterId],
      foreignColumns: [foodMasterNutrition.foodMasterId],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      name: 'food_master_nutrients_nutrient_code_fk',
      columns: [table.nutrientCode],
      foreignColumns: [nutrientDefinitions.code],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    index('food_master_nutrients_nutrient_code_idx').on(table.nutrientCode),
    check('food_master_nutrients_value_nonneg', sql`${table.value} >= 0`),
  ],
)

export const mealLogs = pgTable(
  'meal_logs',
  {
    id: text('id').primaryKey(),
    foodMasterId: text('food_master_id').notNull(),
    // JST calendar date, no time component — see src/lib/jst-date.ts.
    eatenDate: date('eaten_date', { mode: 'string' })
      .$type<JstDate>()
      .notNull(),
    mealType: mealTypeEnum('meal_type').notNull(),
    // Multiplier against the food_master's own nutrition values (which are
    // "per one of this food_master"), e.g. quantity=1.5 for one and a half
    // servings.
    quantity: numeric('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: 'meal_logs_food_master_id_fk',
      columns: [table.foodMasterId],
      foreignColumns: [foodMasters.id],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    index('meal_logs_eaten_date_idx').on(table.eatenDate.desc()),
    index('meal_logs_food_master_id_eaten_date_idx').on(
      table.foodMasterId,
      table.eatenDate.desc(),
    ),
    check('meal_logs_quantity_positive', sql`${table.quantity} > 0`),
  ],
)

export const mealSkips = pgTable(
  'meal_skips',
  {
    // Not the primary key: every lookup (repository, routes) keys off
    // (date, meal_type) instead. Kept as an opaque external identifier for
    // API responses.
    id: text('id').notNull(),
    // JST calendar date, no time component — see src/lib/jst-date.ts.
    date: date('date', { mode: 'string' }).$type<JstDate>().notNull(),
    mealType: mealTypeEnum('meal_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({
      name: 'meal_skips_pkey',
      columns: [table.date, table.mealType],
    }),
    uniqueIndex('meal_skips_id_key').on(table.id),
  ],
)

export const storageLocations = pgTable(
  'storage_locations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    capacity: numeric('capacity'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('storage_locations_name_key').on(table.name),
    check(
      'storage_locations_capacity_positive',
      sql`${table.capacity} IS NULL OR ${table.capacity} > 0`,
    ),
  ],
)

export const stockItems = pgTable(
  'stock_items',
  {
    foodMasterId: text('food_master_id').primaryKey(),
    storageLocationId: text('storage_location_id'),
    eatWithinDays: integer('eat_within_days'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: 'stock_items_food_master_id_fk',
      columns: [table.foodMasterId],
      foreignColumns: [foodMasters.id],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      name: 'stock_items_storage_location_id_fk',
      columns: [table.storageLocationId],
      foreignColumns: [storageLocations.id],
    })
      .onUpdate('cascade')
      .onDelete('set null'),
    index('stock_items_storage_location_id_idx').on(table.storageLocationId),
    check(
      'stock_items_eat_within_days_positive',
      sql`${table.eatWithinDays} IS NULL OR ${table.eatWithinDays} > 0`,
    ),
  ],
)

export const stockLots = pgTable(
  'stock_lots',
  {
    id: text('id').primaryKey(),
    foodMasterId: text('food_master_id').notNull(),
    quantity: numeric('quantity').notNull(),
    receivedDate: date('received_date', { mode: 'string' }),
    bestBefore: date('best_before', { mode: 'string' }),
    eatBy: date('eat_by', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: 'stock_lots_food_master_id_fk',
      columns: [table.foodMasterId],
      foreignColumns: [foodMasters.id],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    index('stock_lots_food_master_id_received_date_idx').on(
      table.foodMasterId,
      table.receivedDate,
    ),
    check('stock_lots_quantity_positive', sql`${table.quantity} > 0`),
  ],
)

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: text('id').primaryKey(),
    stockLotId: text('stock_lot_id').notNull(),
    delta: numeric('delta').notNull(),
    reason: text('reason').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: 'stock_movements_stock_lot_id_fk',
      columns: [table.stockLotId],
      foreignColumns: [stockLots.id],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    index('stock_movements_stock_lot_id_idx').on(table.stockLotId),
    check('stock_movements_delta_nonzero', sql`${table.delta} <> 0`),
    check(
      'stock_movements_reason_valid',
      sql`${table.reason} IN ('receive', 'meal', 'count')`,
    ),
  ],
)

export const foodCompositions = pgTable(
  'food_compositions',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
  },
  (table) => [
    index('food_compositions_name_idx').on(table.name),
    index('food_compositions_name_trgm_idx').using(
      'gin',
      sql`${table.name} gin_trgm_ops`,
    ),
  ],
)

export const foodCompositionNutrients = pgTable(
  'food_composition_nutrients',
  {
    foodCompositionCode: text('food_composition_code').notNull(),
    nutrientCode: text('nutrient_code').notNull(),
    value: numeric('value').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'food_composition_nutrients_pkey',
      columns: [table.foodCompositionCode, table.nutrientCode],
    }),
    foreignKey({
      name: 'food_composition_nutrients_food_composition_code_fk',
      columns: [table.foodCompositionCode],
      foreignColumns: [foodCompositions.code],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      name: 'food_composition_nutrients_nutrient_code_fk',
      columns: [table.nutrientCode],
      foreignColumns: [nutrientDefinitions.code],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    index('food_composition_nutrients_nutrient_code_idx').on(
      table.nutrientCode,
    ),
    check('food_composition_nutrients_value_nonneg', sql`${table.value} >= 0`),
  ],
)

export const userProfiles = pgTable(
  'user_profiles',
  {
    id: smallint('id').primaryKey().default(1),
    likes: text('likes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dislikes: text('dislikes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    allergies: text('allergies')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    constraints: text('constraints')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dailyTargets: jsonb('daily_targets').$type<Record<string, number>>(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check('user_profiles_singleton', sql`${table.id} = 1`),
    check(
      'user_profiles_daily_targets_object',
      sql`${table.dailyTargets} IS NULL OR jsonb_typeof(${table.dailyTargets}) = 'object'`,
    ),
  ],
)
