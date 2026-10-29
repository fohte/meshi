import { err, ok, type Result } from 'neverthrow'
import { z } from 'zod'

import type { SqlOrTx } from '#db/index'
import { numericValueSchema } from '#db/numeric-value-schema'
import { MealLogPersistenceError } from '#domain/meal-log/errors'
import type { NutritionMap } from '#domain/meal-log/types'

const nutrientRowSchema = z.object({
  nutrition_version_id: z.uuid(),
  nutrient_code: z.string(),
  value: numericValueSchema,
})

export const parseRows = <T extends z.ZodType>(
  schema: T,
  rows: unknown,
  queryName: string,
): Result<z.output<T>, MealLogPersistenceError> => {
  const parsed = schema.safeParse(rows)
  return parsed.success
    ? ok(parsed.data)
    : err(
        new MealLogPersistenceError(
          `${queryName} returned invalid rows: ${parsed.error.message}`,
        ),
      )
}

export const readNutrition = async (
  tx: SqlOrTx,
  nutritionVersionIds: ReadonlyArray<string>,
): Promise<
  Result<ReadonlyMap<string, NutritionMap>, MealLogPersistenceError>
> => {
  const rows = await tx<Record<string, unknown>[]>`
    SELECT nutrition_version_id, nutrient_code, value
    FROM food_master_nutrients
    WHERE nutrition_version_id = ANY(${tx.array([...nutritionVersionIds])}::uuid[])
    ORDER BY nutrition_version_id, nutrient_code
  `
  const parsed = parseRows(z.array(nutrientRowSchema), rows, 'nutrition query')
  if (parsed.isErr()) return err(parsed.error)

  const maps = new Map<string, Record<string, number>>()
  for (const row of parsed.value) {
    const nutrition = maps.get(row.nutrition_version_id) ?? {}
    nutrition[row.nutrient_code] = row.value
    maps.set(row.nutrition_version_id, nutrition)
  }
  return ok(maps)
}
