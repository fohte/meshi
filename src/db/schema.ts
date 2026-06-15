import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
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

export const foodSourceEnum = pgEnum('food_source', [
  'web_search',
  'composition_table_estimate',
  'user_input',
])

export const nutrientUnitEnum = pgEnum('nutrient_unit', [
  'kcal',
  'g',
  'mg',
  'µg',
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
    isEstimated: boolean('is_estimated').notNull().default(false),
    source: foodSourceEnum('source').notNull(),
    sourceUrl: text('source_url'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('food_masters_name_key').on(table.name),
    index('food_masters_is_estimated_idx')
      .on(table.isEstimated)
      .where(sql`${table.isEstimated} = true`),
    index('food_masters_name_trgm_idx').using(
      'gin',
      sql`${table.name} gin_trgm_ops`,
    ),
    check(
      'food_masters_estimated_not_web_search',
      sql`${table.isEstimated} = false OR ${table.source} <> 'web_search'`,
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
      foreignColumns: [foodMasters.id],
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
    eatenAt: timestamp('eaten_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    quantity: numeric('quantity').notNull(),
    unit: text('unit').notNull(),
    note: text('note'),
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
    index('meal_logs_eaten_at_idx').on(table.eatenAt.desc()),
    index('meal_logs_food_master_id_eaten_at_idx').on(
      table.foodMasterId,
      table.eatenAt.desc(),
    ),
    check('meal_logs_quantity_positive', sql`${table.quantity} > 0`),
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
    dailyTargets: jsonb('daily_targets'),
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
