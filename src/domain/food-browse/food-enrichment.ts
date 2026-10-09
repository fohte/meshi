import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { foodMasterNutrients, foodMasters } from '#db/schema'
import type { FoodSource } from '#domain/food-master/types'

export type FoodSearchDb = ReturnType<typeof drizzle>
export const ENERGY_KCAL_CODE = 'energy_kcal'

export interface FoodMasterEnrichment {
  readonly source: FoodSource
  readonly energyKcalPerUnit: number | null
}

export class FoodMasterEnrichmentError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'FoodMasterEnrichmentError'
  }
}

export const finiteNumeric = z.union([
  z.number(),
  z.string().transform((value, ctx) => {
    const numberValue = Number(value)
    if (!Number.isFinite(numberValue)) {
      ctx.addIssue({
        code: 'custom',
        message: `expected a finite numeric, got ${value}`,
      })
      return z.NEVER
    }
    return numberValue
  }),
])

const enrichmentRowsSchema = z.array(
  z.object({
    id: z.string(),
    source: z.enum(['web_search', 'composition_table_estimate', 'user_input']),
    energyKcal: finiteNumeric.nullable(),
  }),
)

export const loadFoodMasterEnrichment = (
  db: FoodSearchDb,
  foodMasterIds: ReadonlyArray<string>,
): ResultAsync<Map<string, FoodMasterEnrichment>, FoodMasterEnrichmentError> =>
  foodMasterIds.length === 0
    ? okAsync(new Map<string, FoodMasterEnrichment>())
    : ResultAsync.fromPromise(
        db
          .select({
            id: foodMasters.id,
            source: foodMasters.source,
            energyKcal: foodMasterNutrients.value,
          })
          .from(foodMasters)
          .leftJoin(
            foodMasterNutrients,
            and(
              eq(foodMasterNutrients.foodMasterId, foodMasters.id),
              eq(foodMasterNutrients.nutrientCode, ENERGY_KCAL_CODE),
            ),
          )
          .where(inArray(foodMasters.id, [...foodMasterIds])),
        (caughtErr) =>
          new FoodMasterEnrichmentError(
            'failed to load food master enrichment',
            caughtErr,
          ),
      ).andThen((rows) => {
        const parsed = enrichmentRowsSchema.safeParse(rows)
        if (!parsed.success) {
          return errAsync(
            new FoodMasterEnrichmentError(
              `food master enrichment returned invalid rows: ${parsed.error.message}`,
              parsed.error,
            ),
          )
        }
        return okAsync(
          new Map<string, FoodMasterEnrichment>(
            parsed.data.map(
              (row) =>
                [
                  row.id,
                  { source: row.source, energyKcalPerUnit: row.energyKcal },
                ] as const,
            ),
          ),
        )
      })
