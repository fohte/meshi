import { z } from 'zod'

import type { Sql } from '#db/index'
import type {
  deliveries,
  foodCompositionNutrients,
  foodCompositions,
  foodMasterAliases,
  foodMasterNutrients,
  foodMasterNutrition,
  foodMasters,
  mealLogs,
  mealPhotos,
  mealSetItems,
  mealSets,
  nutrientDefinitions,
  stockItems,
  stockLots,
  stockMovements,
  storageLocations,
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
    INSERT INTO food_master_nutrients (nutrition_version_id, nutrient_code, value)
    VALUES (${values.nutritionVersionId}, ${values.nutrientCode}, ${values.value})
  `
}

export const seedFoodMasterNutritionVersion = async (
  sql: Sql,
  values: Omit<
    typeof foodMasterNutrition.$inferInsert,
    'id' | 'createdAt' | 'legacyEvidence'
  > & {
    nutrients?: Readonly<Record<string, number>>
  },
): Promise<string> => {
  const { nutrients, ...row } = values
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

  const rows = await sql`
    INSERT INTO food_master_nutrition (
      food_master_id,
      version_no,
      is_current,
      change_kind,
      corrects_version_id,
      is_estimated,
      source,
      source_url,
      source_composition_code,
      serving_basis,
      net_content,
      checked_on,
      effective_from,
      reason,
      legacy_evidence
    )
    VALUES (
      ${row.foodMasterId},
      ${row.versionNo},
      ${row.isCurrent},
      ${row.changeKind},
      ${row.correctsVersionId ?? null},
      ${row.isEstimated ?? false},
      ${row.source},
      ${row.sourceUrl ?? null},
      ${row.sourceCompositionCode ?? null},
      ${row.servingBasis ?? null},
      ${row.netContent ?? null},
      ${row.checkedOn ?? null},
      ${row.effectiveFrom ?? null},
      ${row.reason ?? null},
      false
    )
    RETURNING id
  `
  const nutritionVersionId = z.object({ id: z.uuid() }).parse(rows[0]).id
  for (const [nutrientCode, value] of nutrientEntries) {
    await seedFoodMasterNutrient(sql, {
      nutritionVersionId,
      nutrientCode,
      value,
    })
  }
  return nutritionVersionId
}

export const seedFoodMaster = async (
  sql: Sql,
  values: Omit<typeof foodMasters.$inferInsert, 'createdAt'> &
    Pick<
      typeof foodMasterNutrition.$inferInsert,
      'isEstimated' | 'source' | 'sourceUrl' | 'sourceCompositionCode'
    > & {
      nutrients?: Readonly<Record<string, number>>
    },
): Promise<void> => {
  const {
    id,
    name,
    nutrients,
    isEstimated,
    source,
    sourceUrl,
    sourceCompositionCode,
  } = values
  const nutrientEntries = Object.entries(nutrients ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  )
  // Seed definitions before food masters so concurrent test transactions
  // acquire nutrient and food-master locks consistently.
  for (const [nutrientCode] of nutrientEntries) {
    await seedNutrientDefinition(sql, {
      code: nutrientCode,
      displayName: nutrientCode,
      unit: 'g',
      isMajor: false,
      sortOrder: 0,
    })
  }

  await sql`INSERT INTO food_masters (id, name) VALUES (${id}, ${name})`
  const nutritionVersionId = await seedFoodMasterNutritionVersion(sql, {
    foodMasterId: id,
    versionNo: 1,
    isCurrent: true,
    changeKind: 'initial',
    isEstimated,
    source,
    sourceUrl,
    sourceCompositionCode,
  })
  for (const [nutrientCode, value] of nutrientEntries) {
    await seedFoodMasterNutrient(sql, {
      nutritionVersionId,
      nutrientCode,
      value,
    })
  }
}

export const seedFoodMasterWithoutNutrition = async (
  sql: Sql,
  values: typeof foodMasters.$inferInsert,
): Promise<void> => {
  await sql`INSERT INTO food_masters (id, name) VALUES (${values.id}, ${values.name})`
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
  values: Omit<
    typeof mealLogs.$inferInsert,
    'quantity' | 'nutritionVersionOrigin'
  > & {
    quantity: number
    nutritionVersionOrigin?: typeof mealLogs.$inferInsert.nutritionVersionOrigin
  },
): Promise<void> => {
  const currentVersionRows =
    values.nutritionVersionId === undefined
      ? await sql`
          SELECT id
          FROM food_master_nutrition
          WHERE food_master_id = ${values.foodMasterId} AND is_current = true
        `
      : []
  const nutritionVersionId =
    values.nutritionVersionId === undefined
      ? (z.array(z.object({ id: z.uuid() })).parse(currentVersionRows)[0]?.id ??
        null)
      : values.nutritionVersionId
  await sql`
    INSERT INTO meal_logs (
      id,
      food_master_id,
      nutrition_version_id,
      nutrition_version_origin,
      eaten_date,
      meal_type,
      quantity,
      created_at
    )
    VALUES (
      ${values.id},
      ${values.foodMasterId},
      ${nutritionVersionId},
      ${values.nutritionVersionOrigin ?? 'recorded'},
      ${values.eatenDate},
      ${values.mealType},
      ${values.quantity},
      COALESCE(${values.createdAt?.toISOString() ?? null}::timestamptz, now())
    )
  `
}

export const seedMealPhoto = async (
  sql: Sql,
  values: typeof mealPhotos.$inferInsert,
): Promise<void> => {
  await sql`
    INSERT INTO meal_photos (
      id, eaten_date, meal_type, object_key, content_type, created_at
    )
    VALUES (
      ${values.id},
      ${values.eatenDate},
      ${values.mealType},
      ${values.objectKey},
      ${values.contentType},
      COALESCE(${values.createdAt?.toISOString() ?? null}::timestamptz, now())
    )
  `
}

export const seedMealSet = async (
  sql: Sql,
  values: typeof mealSets.$inferInsert,
): Promise<void> => {
  await sql`
    INSERT INTO meal_sets (id, name, created_at)
    VALUES (
      ${values.id},
      ${values.name},
      COALESCE(${values.createdAt?.toISOString() ?? null}::timestamptz, now())
    )
  `
}

export const seedMealSetItem = async (
  sql: Sql,
  values: Omit<typeof mealSetItems.$inferInsert, 'quantity'> & {
    quantity: number
  },
): Promise<void> => {
  await sql`
    INSERT INTO meal_set_items (meal_set_id, food_master_id, quantity)
    VALUES (${values.mealSetId}, ${values.foodMasterId}, ${values.quantity})
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

export const seedStorageLocation = async (
  sql: Sql,
  values: Omit<
    typeof storageLocations.$inferInsert,
    'createdAt' | 'capacity'
  > & {
    capacity?: number | null
  },
): Promise<void> => {
  await sql`
    INSERT INTO storage_locations (id, name, capacity)
    VALUES (${values.id}, ${values.name}, ${values.capacity ?? null})
  `
}

export const seedStockItem = async (
  sql: Sql,
  values: Omit<typeof stockItems.$inferInsert, 'createdAt'>,
): Promise<void> => {
  await sql`
    INSERT INTO stock_items (food_master_id, storage_location_id, eat_within_days)
    VALUES (
      ${values.foodMasterId}, ${values.storageLocationId ?? null},
      ${values.eatWithinDays ?? null}
    )
  `
}

export const seedDelivery = async (
  sql: Sql,
  values: Omit<typeof deliveries.$inferInsert, 'createdAt'>,
): Promise<void> => {
  await sql`
    INSERT INTO deliveries (
      id, source_ref, status, expected_date, received_date, change_deadline
    ) VALUES (
      ${values.id}, ${values.sourceRef ?? null},
      ${values.status ?? 'planned'}, ${values.expectedDate},
      ${values.receivedDate ?? null}, ${values.changeDeadline ?? null}
    )
  `
}

export const seedStockLot = async (
  sql: Sql,
  values: Omit<typeof stockLots.$inferInsert, 'createdAt' | 'quantity'> & {
    quantity: number
  },
): Promise<void> => {
  await sql`
    INSERT INTO stock_lots (
      id, food_master_id, delivery_id, quantity, received_date, best_before, eat_by
    ) VALUES (
      ${values.id}, ${values.foodMasterId}, ${values.deliveryId ?? null},
      ${values.quantity},
      ${values.receivedDate ?? null}, ${values.bestBefore ?? null},
      ${values.eatBy ?? null}
    )
  `
}

export const seedStockMovement = async (
  sql: Sql,
  values: Omit<typeof stockMovements.$inferInsert, 'createdAt' | 'delta'> & {
    delta: number
  },
): Promise<void> => {
  await sql`
    INSERT INTO stock_movements (
      id, stock_lot_id, delta, reason, note, meal_log_id
    )
    VALUES (
      ${values.id}, ${values.stockLotId}, ${values.delta},
      ${values.reason}, ${values.note ?? null}, ${values.mealLogId ?? null}
    )
  `
}
