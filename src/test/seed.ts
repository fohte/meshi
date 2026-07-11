import type { JsonValue, Sql } from '@/db'
import type {
  a2aPushConfigs,
  a2aTasks,
  foodCompositions,
  foodMasterNutrients,
  foodMasters,
  mealLogs,
  nutrientDefinitions,
} from '@/db/schema'

export const seedNutrientDefinition = async (
  sql: Sql,
  values: typeof nutrientDefinitions.$inferInsert,
): Promise<void> => {
  await sql`
    INSERT INTO nutrient_definitions (code, display_name, unit, is_major, sort_order)
    VALUES (
      ${values.code},
      ${values.displayName},
      ${values.unit},
      ${values.isMajor ?? false},
      ${values.sortOrder ?? 0}
    )
    ON CONFLICT (code) DO NOTHING
  `
}

const seedFoodMasterNutrient = async (
  sql: Sql,
  values: Omit<typeof foodMasterNutrients.$inferInsert, 'value'> & {
    value: number
  },
): Promise<void> => {
  await sql`
    INSERT INTO food_master_nutrients (food_master_id, nutrient_code, value)
    VALUES (${values.foodMasterId}, ${values.nutrientCode}, ${values.value})
  `
}

export const seedFoodMaster = async (
  sql: Sql,
  values: Omit<typeof foodMasters.$inferInsert, 'createdAt'> & {
    nutrients?: Readonly<Record<string, number>>
  },
): Promise<void> => {
  const { nutrients, ...row } = values
  await sql`
    INSERT INTO food_masters (id, name, is_estimated, source, source_url)
    VALUES (
      ${row.id},
      ${row.name},
      ${row.isEstimated ?? false},
      ${row.source},
      ${row.sourceUrl ?? null}
    )
  `
  // Nutrient codes referenced by a seeded food need a definition row to
  // satisfy the FK; ON CONFLICT DO NOTHING lets a test seed its own
  // definitions first (e.g. with real display names/units) without this
  // loop clobbering them.
  for (const [nutrientCode, value] of Object.entries(nutrients ?? {})) {
    await seedNutrientDefinition(sql, {
      code: nutrientCode,
      displayName: nutrientCode,
      unit: 'g',
    })
    await seedFoodMasterNutrient(sql, {
      foodMasterId: row.id,
      nutrientCode,
      value,
    })
  }
}

export const seedMealLog = async (
  sql: Sql,
  values: Omit<
    typeof mealLogs.$inferInsert,
    'quantity' | 'unit' | 'createdAt'
  > & {
    quantity: number
    unit?: string
  },
): Promise<void> => {
  await sql`
    INSERT INTO meal_logs (id, food_master_id, eaten_at, quantity, unit, note)
    VALUES (
      ${values.id},
      ${values.foodMasterId},
      ${values.eatenAt},
      ${values.quantity},
      ${values.unit ?? 'g'},
      ${values.note ?? null}
    )
  `
}

export const seedFoodComposition = async (
  sql: Sql,
  values: typeof foodCompositions.$inferInsert,
): Promise<void> => {
  await sql`
    INSERT INTO food_compositions (code, name)
    VALUES (${values.code}, ${values.name})
  `
}

export const seedA2aTask = async (
  sql: Sql,
  values: Omit<
    typeof a2aTasks.$inferInsert,
    'createdAt' | 'protocolVersion' | 'task'
  > & {
    protocolVersion?: string
    task: JsonValue
  },
): Promise<void> => {
  await sql`
    INSERT INTO a2a_tasks (task_id, context_id, state, status_timestamp, protocol_version, task)
    VALUES (
      ${values.taskId},
      ${values.contextId},
      ${values.state},
      ${values.statusTimestamp},
      ${values.protocolVersion ?? '0.3'},
      ${sql.json(values.task)}
    )
  `
}

export const seedA2aPushConfig = async (
  sql: Sql,
  values: Omit<typeof a2aPushConfigs.$inferInsert, 'createdAt' | 'config'> & {
    config: JsonValue
  },
): Promise<void> => {
  await sql`
    INSERT INTO a2a_push_configs (task_id, config_id, config)
    VALUES (${values.taskId}, ${values.configId}, ${sql.json(values.config)})
  `
}
