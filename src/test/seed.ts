import type { JsonValue, Sql } from '#db/index'
import type {
  a2aPushConfigs,
  foodCompositions,
  foodMasterAliases,
  foodMasterNutrients,
  foodMasters,
  mealLogs,
  mealSkips,
  nutrientDefinitions,
} from '#db/schema'

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
    INSERT INTO food_masters (id, name, is_estimated, source, source_url, source_composition_code)
    VALUES (
      ${row.id},
      ${row.name},
      ${row.isEstimated ?? false},
      ${row.source},
      ${row.sourceUrl ?? null},
      ${row.sourceCompositionCode ?? null}
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

export const seedFoodMasterAlias = async (
  sql: Sql,
  values: typeof foodMasterAliases.$inferInsert,
): Promise<void> => {
  await sql`
    INSERT INTO food_master_aliases (id, food_master_id, alias)
    VALUES (${values.id}, ${values.foodMasterId}, ${values.alias})
  `
}

export const seedMealLog = async (
  sql: Sql,
  values: Omit<typeof mealLogs.$inferInsert, 'quantity' | 'createdAt'> & {
    quantity: number
  },
): Promise<void> => {
  await sql`
    INSERT INTO meal_logs (id, food_master_id, eaten_date, meal_type, quantity)
    VALUES (
      ${values.id},
      ${values.foodMasterId},
      ${values.eatenDate},
      ${values.mealType},
      ${values.quantity}
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

export const seedMealSkip = async (
  sql: Sql,
  values: Omit<typeof mealSkips.$inferInsert, 'createdAt'>,
): Promise<void> => {
  await sql`
    INSERT INTO meal_skips (id, date, meal_type)
    VALUES (${values.id}, ${values.date}, ${values.mealType})
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
