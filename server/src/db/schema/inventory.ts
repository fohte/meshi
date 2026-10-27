import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { deliveryStatusEnum } from '#db/schema/enums'
import { foodMasters } from '#db/schema/foods'
import { mealLogs } from '#db/schema/meals'

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

export const deliverySourceRefs = pgTable(
  'delivery_source_refs',
  {
    sourceRef: text('source_ref').primaryKey(),
    deliveryId: text('delivery_id')
      .notNull()
      .references((): AnyPgColumn => deliveries.id, { onUpdate: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('delivery_source_refs_delivery_id_source_ref_key').on(
      table.deliveryId,
      table.sourceRef,
    ),
    check(
      'delivery_source_refs_source_ref_nonblank',
      sql`btrim(${table.sourceRef}) <> ''`,
    ),
  ],
)

export const deliveries = pgTable(
  'deliveries',
  {
    id: text('id').primaryKey(),
    sourceRef: text('source_ref'),
    status: deliveryStatusEnum('status').notNull().default('planned'),
    expectedDate: date('expected_date', { mode: 'string' }).notNull(),
    receivedDate: date('received_date', { mode: 'string' }),
    changeDeadline: date('change_deadline', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex('deliveries_source_ref_key').on(table.sourceRef),
    foreignKey({
      name: 'deliveries_id_source_ref_fk',
      columns: [table.id, table.sourceRef],
      foreignColumns: [
        deliverySourceRefs.deliveryId,
        deliverySourceRefs.sourceRef,
      ],
    }),
    index('deliveries_status_expected_date_idx').on(
      table.status,
      table.expectedDate,
    ),
    check(
      'deliveries_received_date_matches_status',
      sql`(${table.status} = 'received') = (${table.receivedDate} IS NOT NULL)`,
    ),
    check(
      'deliveries_source_ref_nonblank',
      sql`${table.sourceRef} IS NULL OR btrim(${table.sourceRef}) <> ''`,
    ),
  ],
)

export const stockLots = pgTable(
  'stock_lots',
  {
    id: text('id').primaryKey(),
    foodMasterId: text('food_master_id').notNull(),
    deliveryId: text('delivery_id'),
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
    foreignKey({
      name: 'stock_lots_delivery_id_fk',
      columns: [table.deliveryId],
      foreignColumns: [deliveries.id],
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    index('stock_lots_food_master_id_received_date_idx').on(
      table.foodMasterId,
      table.receivedDate,
    ),
    uniqueIndex('stock_lots_delivery_id_food_master_id_key').on(
      table.deliveryId,
      table.foodMasterId,
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
    mealLogId: text('meal_log_id'),
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
    foreignKey({
      name: 'stock_movements_meal_log_id_fk',
      columns: [table.mealLogId],
      foreignColumns: [mealLogs.id],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    index('stock_movements_stock_lot_id_idx').on(table.stockLotId),
    index('stock_movements_meal_log_id_idx').on(table.mealLogId),
    check('stock_movements_delta_nonzero', sql`${table.delta} <> 0`),
    check(
      'stock_movements_reason_valid',
      sql`${table.reason} IN ('receive', 'meal', 'count')`,
    ),
    check(
      'stock_movements_meal_log_reason',
      sql`(${table.reason} = 'meal') = (${table.mealLogId} IS NOT NULL)`,
    ),
  ],
)
