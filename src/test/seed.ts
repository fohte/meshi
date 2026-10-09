import type postgres from 'postgres'

import type { Sql } from '#db/index'
import type {
  a2aPushConfigs,
  foodCompositionNutrients,
  foodCompositions,
  foodMasterAliases,
  foodMasterNutrients,
  foodMasters,
  mealLogs,
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
  // Seed definitions in a stable code order before food masters so concurrent
  // test transactions acquire nutrient and food-master locks consistently.
  // ON CONFLICT DO NOTHING preserves any custom definitions the test seeded.
  const nutrientEntries = Object.entries(nutrients ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  )
  for (const [nutrientCode] of nutrientEntries) {
    await seedNutrientDefinition(sql, {
      code: nutrientCode,
      displayName: nutrientCode,
      unit: 'g',
    })
  }

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
  for (const [nutrientCode, value] of nutrientEntries) {
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
  values: Omit<typeof mealLogs.$inferInsert, 'quantity'> & {
    quantity: number
  },
): Promise<void> => {
  await sql`
    INSERT INTO meal_logs (id, food_master_id, eaten_date, meal_type, quantity, created_at)
    VALUES (
      ${values.id},
      ${values.foodMasterId},
      ${values.eatenDate},
      ${values.mealType},
      ${values.quantity},
      COALESCE(${values.createdAt?.toISOString() ?? null}::timestamptz, now())
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

export const seedFoodCompositionNutrient = async (
  sql: Sql,
  values: Omit<typeof foodCompositionNutrients.$inferInsert, 'value'> & {
    value: number
    unit: typeof nutrientDefinitions.$inferInsert.unit
  },
): Promise<void> => {
  await seedNutrientDefinition(sql, {
    code: values.nutrientCode,
    displayName: values.nutrientCode,
    unit: values.unit,
  })
  await sql`
    INSERT INTO food_composition_nutrients (food_composition_code, nutrient_code, value)
    VALUES (${values.foodCompositionCode}, ${values.nutrientCode}, ${values.value})
  `
}

export const seedA2aPushConfig = async (
  sql: Sql,
  values: Omit<typeof a2aPushConfigs.$inferInsert, 'createdAt' | 'config'> & {
    config: postgres.JSONValue
  },
): Promise<void> => {
  await sql`
    INSERT INTO a2a_push_configs (task_id, config_id, config)
    VALUES (${values.taskId}, ${values.configId}, ${sql.json(values.config)})
  `
}
