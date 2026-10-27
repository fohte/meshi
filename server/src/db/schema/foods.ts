import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { foodSourceEnum, nutrientUnitEnum } from '#db/schema/enums'

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
