import type { JsonValue, Sql } from '#db/index'
import type {
  a2aPushConfigs,
  foodCompositions,
  foodMasterNutrients,
  foodMasters,
  foodMasterUnits,
  mealLogs,
  nutrientDefinitions,
} from '#db/schema'
import { inferMealType } from '#domain/meal-log/infer-meal-type'

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
    'mealType' | 'quantity' | 'unit' | 'amountGrams' | 'createdAt'
  > & {
    mealType?: (typeof mealLogs.$inferInsert)['mealType']
    quantity: number
    unit?: string
    // Defaults to quantity, which is only correct for the default 'g' unit
    // — pass it explicitly alongside a non-gram unit.
    amountGrams?: number
  },
): Promise<void> => {
  await sql`
    INSERT INTO meal_logs (id, food_master_id, eaten_at, meal_type, quantity, unit, amount_grams, note)
    VALUES (
      ${values.id},
      ${values.foodMasterId},
      ${values.eatenAt},
      ${values.mealType ?? inferMealType(values.eatenAt)},
      ${values.quantity},
      ${values.unit ?? 'g'},
      ${values.amountGrams ?? values.quantity},
      ${values.note ?? null}
    )
  `
}

export const seedFoodMasterUnit = async (
  sql: Sql,
  values: Omit<typeof foodMasterUnits.$inferInsert, 'gramsPerUnit'> & {
    gramsPerUnit: number
  },
): Promise<void> => {
  await sql`
    INSERT INTO food_master_units (food_master_id, unit, grams_per_unit)
    VALUES (${values.foodMasterId}, ${values.unit}, ${values.gramsPerUnit})
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
