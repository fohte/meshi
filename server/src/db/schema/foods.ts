import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    foodMasterId: text('food_master_id').notNull(),
    versionNo: integer('version_no').notNull(),
    isCurrent: boolean('is_current').notNull(),
    changeKind: text('change_kind').notNull(),
    correctsVersionId: uuid('corrects_version_id'),
    isEstimated: boolean('is_estimated').notNull().default(false),
    source: foodSourceEnum('source').notNull(),
    sourceUrl: text('source_url'),
    sourceCompositionCode: text('source_composition_code'),
    servingBasis: text('serving_basis'),
    netContent: text('net_content'),
    checkedOn: date('checked_on', { mode: 'string' }),
    effectiveFrom: date('effective_from', { mode: 'string' }),
    reason: text('reason'),
    legacyEvidence: boolean('legacy_evidence').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('food_master_nutrition_food_master_id_version_no_key').on(
      table.foodMasterId,
      table.versionNo,
    ),
    uniqueIndex('food_master_nutrition_food_master_id_id_key').on(
      table.foodMasterId,
      table.id,
    ),
    uniqueIndex('food_master_nutrition_current_food_master_id_key')
      .on(table.foodMasterId)
      .where(sql`${table.isCurrent} = true`),
    foreignKey({
      name: 'food_master_nutrition_food_master_id_fk',
      columns: [table.foodMasterId],
      foreignColumns: [foodMasters.id],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      name: 'food_master_nutrition_corrects_version_fk',
      columns: [table.foodMasterId, table.correctsVersionId],
      foreignColumns: [table.foodMasterId, table.id],
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
    index('food_master_nutrition_food_master_id_idx').on(table.foodMasterId),
    index('food_master_nutrition_is_estimated_idx')
      .on(table.isEstimated)
      .where(sql`${table.isEstimated} = true`),
    index('food_master_nutrition_source_composition_code_idx').on(
      table.sourceCompositionCode,
    ),
    // Historical rows retain their source values even when they predate these evidence rules.
    check(
      'food_master_nutrition_web_search_evidence',
      sql`${table.legacyEvidence} = true OR ${table.source} <> 'web_search' OR (${table.isEstimated} = false AND ${table.sourceUrl} IS NOT NULL AND ${table.sourceCompositionCode} IS NULL)`,
    ),
    check(
      'food_master_nutrition_composition_evidence',
      sql`${table.legacyEvidence} = true OR ${table.source} <> 'composition_table_estimate' OR (${table.isEstimated} = true AND ${table.sourceUrl} IS NULL AND ${table.sourceCompositionCode} IS NOT NULL)`,
    ),
    check(
      'food_master_nutrition_user_input_evidence',
      sql`${table.legacyEvidence} = true OR ${table.source} <> 'user_input' OR (${table.sourceUrl} IS NULL AND ${table.sourceCompositionCode} IS NULL)`,
    ),
    check(
      'food_master_nutrition_model_estimate_evidence',
      sql`${table.legacyEvidence} = true OR ${table.source}::text <> 'model_estimate' OR (${table.isEstimated} = true AND ${table.sourceUrl} IS NULL AND ${table.sourceCompositionCode} IS NULL)`,
    ),
    check(
      'food_master_nutrition_version_no_positive',
      sql`${table.versionNo} > 0`,
    ),
    check(
      'food_master_nutrition_change_kind_check',
      sql`${table.changeKind} IN ('initial', 'product_update', 'correction')`,
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
    nutritionVersionId: uuid('nutrition_version_id').notNull(),
    nutrientCode: text('nutrient_code').notNull(),
    value: numeric('value').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'food_master_nutrients_pkey',
      columns: [table.nutritionVersionId, table.nutrientCode],
    }),
    foreignKey({
      name: 'food_master_nutrients_nutrition_version_id_fk',
      columns: [table.nutritionVersionId],
      foreignColumns: [foodMasterNutrition.id],
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
