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

export const a2aTaskStateEnum = pgEnum('a2a_task_state', [
  'submitted',
  'working',
  'input-required',
  'completed',
  'canceled',
  'failed',
  'rejected',
  'auth-required',
  'unknown',
])

export const a2aTasks = pgTable(
  'a2a_tasks',
  {
    taskId: text('task_id').primaryKey(),
    contextId: text('context_id').notNull(),
    state: a2aTaskStateEnum('state').notNull(),
    // Doubles as the watchdog/retention sweep basis: executors publish a
    // working status-update periodically as a heartbeat, so this reflects
    // "last known alive" rather than only the terminal transition time.
    statusTimestamp: timestamp('status_timestamp', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    // Independent of `task.kind`; the A2A Task type carries no protocol
    // version field, so this is meshi's own bookkeeping for a possible
    // future protocol migration.
    protocolVersion: text('protocol_version').notNull().default('0.3'),
    // Left untyped (unknown): this column is the full A2A `Task` object, and
    // typing it here would pull the `@a2a-js/sdk` type into the schema
    // module. The store that owns this table validates the shape at read
    // time instead.
    task: jsonb('task').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index('a2a_tasks_context_idx').on(table.contextId),
    // Covers both the watchdog (`state = 'working'`) and retention
    // (`state IN (terminal states)`) sweeps, so it stays a full index
    // rather than a partial one scoped to either query alone.
    index('a2a_tasks_sweep_idx').on(table.state, table.statusTimestamp),
    check('a2a_tasks_task_object', sql`jsonb_typeof(${table.task}) = 'object'`),
  ],
)

// No foreign key to a2aTasks.taskId: the SDK's DefaultRequestHandler
// persists a push notification config for a new task before that task's
// own row exists (message/send saves the config, then starts the
// executor — the a2a_tasks row is only written once the executor
// publishes its first event). A FK here would reject that write.
export const a2aPushConfigs = pgTable(
  'a2a_push_configs',
  {
    taskId: text('task_id').notNull(),
    configId: text('config_id').notNull(),
    config: jsonb('config').notNull(),
    // Not indexed on its own: rows are only ever pruned by task_id, driven
    // off a2a_tasks retention (see deleteExpiredTerminalTasks), not by an
    // independent age-based sweep of this table.
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({
      name: 'a2a_push_configs_pkey',
      columns: [table.taskId, table.configId],
    }),
    check(
      'a2a_push_configs_config_object',
      sql`jsonb_typeof(${table.config}) = 'object'`,
    ),
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
