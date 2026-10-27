import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { mealTypeEnum } from '#db/schema/enums'
import { foodMasterNutrition, foodMasters } from '#db/schema/foods'
import type { JstDate } from '#lib/jst-date'

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

export const mealLogs = pgTable(
  'meal_logs',
  {
    id: text('id').primaryKey(),
    foodMasterId: text('food_master_id').notNull(),
    nutritionVersionId: uuid('nutrition_version_id'),
    nutritionVersionOrigin: text('nutrition_version_origin').notNull(),
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
    foreignKey({
      name: 'meal_logs_food_master_nutrition_version_fk',
      columns: [table.foodMasterId, table.nutritionVersionId],
      foreignColumns: [
        foodMasterNutrition.foodMasterId,
        foodMasterNutrition.id,
      ],
    }).onUpdate('cascade'),
    index('meal_logs_eaten_date_idx').on(table.eatenDate.desc()),
    index('meal_logs_food_master_id_eaten_date_idx').on(
      table.foodMasterId,
      table.eatenDate.desc(),
    ),
    index('meal_logs_nutrition_version_id_idx').on(table.nutritionVersionId),
    check('meal_logs_quantity_positive', sql`${table.quantity} > 0`),
    check(
      'meal_logs_nutrition_version_origin_check',
      sql`${table.nutritionVersionOrigin} IN ('recorded', 'migrated', 'filled', 'reassigned')`,
    ),
  ],
)

export const mealLogNutritionChanges = pgTable(
  'meal_log_nutrition_changes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    mealLogId: text('meal_log_id').notNull(),
    fromVersionId: uuid('from_version_id'),
    toVersionId: uuid('to_version_id').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: 'meal_log_nutrition_changes_meal_log_id_fk',
      columns: [table.mealLogId],
      foreignColumns: [mealLogs.id],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      name: 'meal_log_nutrition_changes_from_version_id_fk',
      columns: [table.fromVersionId],
      foreignColumns: [foodMasterNutrition.id],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      name: 'meal_log_nutrition_changes_to_version_id_fk',
      columns: [table.toVersionId],
      foreignColumns: [foodMasterNutrition.id],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    index('meal_log_nutrition_changes_meal_log_id_idx').on(table.mealLogId),
    index('meal_log_nutrition_changes_from_version_id_idx').on(
      table.fromVersionId,
    ),
    index('meal_log_nutrition_changes_to_version_id_idx').on(table.toVersionId),
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

export const mealPhotos = pgTable(
  'meal_photos',
  {
    id: text('id').primaryKey(),
    // JST calendar date, no time component — see src/lib/jst-date.ts.
    eatenDate: date('eaten_date', { mode: 'string' })
      .$type<JstDate>()
      .notNull(),
    mealType: mealTypeEnum('meal_type').notNull(),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('meal_photos_object_key_key').on(table.objectKey),
    index('meal_photos_eaten_date_meal_type_idx').on(
      table.eatenDate,
      table.mealType,
    ),
    check(
      'meal_photos_content_type_check',
      sql`${table.contentType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
  ],
)
