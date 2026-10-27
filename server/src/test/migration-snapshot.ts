import { z } from 'zod'

const columnSchema = z.object({
  table_name: z.string(),
  column_name: z.string(),
  data_type: z.string(),
  is_nullable: z.string(),
  column_default: z.string().nullable(),
})

const constraintSchema = z.object({
  name: z.string(),
  table_name: z.string(),
  type: z.string(),
  is_validated: z.boolean(),
})

const migrationSchema = z.object({
  hash: z.string(),
  created_at: z.string(),
})

const nutritionRowSchema = z.object({
  food_master_id: z.string(),
  is_estimated: z.boolean(),
  source: z.string(),
  source_url: z.string().nullable(),
  source_composition_code: z.string().nullable(),
  nutrient_code: z.string(),
  value: z.string(),
})

const mealLogSchema = z.object({
  id: z.string(),
  food_master_id: z.string(),
  eaten_date: z.string(),
  meal_type: z.string(),
  quantity: z.string(),
  created_at: z.string(),
})

const stockMovementSchema = z.object({
  id: z.string(),
  stock_lot_id: z.string(),
  delta: z.string(),
  reason: z.string(),
  note: z.string().nullable(),
  meal_log_id: z.string().nullable(),
  created_at: z.string(),
})

const dailyTotalSchema = z.object({
  eaten_date: z.string(),
  nutrient_code: z.string(),
  value: z.string(),
})

const preservedStateSchema = z.object({
  columns: z.array(columnSchema),
  constraints: z.array(constraintSchema),
  migrations: z.array(migrationSchema),
  nutrition_rows: z.array(nutritionRowSchema),
  meal_logs: z.array(mealLogSchema),
  stock_movements: z.array(stockMovementSchema),
  daily_totals: z.array(dailyTotalSchema),
})

export const migrationSnapshotSchema = z.object({
  before: preservedStateSchema,
  rolled_back: preservedStateSchema,
  after: preservedStateSchema,
  failed_migration_observed: z.boolean(),
  version_assignments: z.array(
    z.object({
      id: z.string(),
      food_master_id: z.string(),
      version_food_master_id: z.string().nullable(),
      version_no: z.number().nullable(),
      origin: z.string(),
    }),
  ),
  versions: z.array(
    z.object({
      food_master_id: z.string(),
      version_no: z.number(),
      is_current: z.boolean(),
      change_kind: z.string(),
      checked_on: z.string().nullable(),
      effective_from: z.string().nullable(),
      serving_basis: z.string().nullable(),
      net_content: z.string().nullable(),
      legacy_evidence: z.boolean(),
    }),
  ),
  evidence_constraints: z.array(
    z.object({ name: z.string(), is_validated: z.boolean() }),
  ),
  change_record_count: z.number(),
  migration_count: z.number(),
})

export type MigrationSnapshot = z.infer<typeof migrationSnapshotSchema>
