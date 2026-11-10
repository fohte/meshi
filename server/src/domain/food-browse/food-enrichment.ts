import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import {
  foodMasterNutrients,
  foodMasterNutrition,
  foodMasters,
  foodSourceEnum,
  nutrientDefinitions,
} from '#db/schema'
import {
  type FoodSource,
  type NutritionStatus,
  nutritionStatusFromIsEstimated,
} from '#domain/food-master/types'

export type FoodSearchDb = ReturnType<typeof drizzle>
export const ENERGY_KCAL_CODE = 'energy_kcal'

export interface FoodMasterEnrichment {
  readonly source: FoodSource | null
  readonly nutritionStatus: NutritionStatus
  readonly nutrition: Readonly<Record<string, number>>
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
    source: z.enum(foodSourceEnum.enumValues).nullable(),
    isEstimated: z.boolean().nullable(),
    nutrientCode: z.string().nullable(),
    nutrientValue: finiteNumeric.nullable(),
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
            source: foodMasterNutrition.source,
            isEstimated: foodMasterNutrition.isEstimated,
            nutrientCode: nutrientDefinitions.code,
            nutrientValue: foodMasterNutrients.value,
          })
          .from(foodMasters)
          .leftJoin(
            foodMasterNutrition,
            and(
              eq(foodMasterNutrition.foodMasterId, foodMasters.id),
              eq(foodMasterNutrition.isCurrent, true),
            ),
          )
          .leftJoin(
            foodMasterNutrients,
            eq(foodMasterNutrients.nutritionVersionId, foodMasterNutrition.id),
          )
          .leftJoin(
            nutrientDefinitions,
            and(
              eq(nutrientDefinitions.code, foodMasterNutrients.nutrientCode),
              eq(nutrientDefinitions.isMajor, true),
            ),
          )
          .where(inArray(foodMasters.id, [...foodMasterIds]))
          .orderBy(foodMasters.id, nutrientDefinitions.sortOrder),
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
        const enrichments = new Map<
          string,
          {
            source: FoodSource | null
            nutritionStatus: NutritionStatus
            nutrition: Record<string, number>
          }
        >()
        for (const row of parsed.data) {
          let enrichment = enrichments.get(row.id)
          if (enrichment === undefined) {
            enrichment = {
              source: row.source,
              nutritionStatus: nutritionStatusFromIsEstimated(row.isEstimated),
              nutrition: {},
            }
            enrichments.set(row.id, enrichment)
          }
          if (row.nutrientCode !== null && row.nutrientValue !== null) {
            enrichment.nutrition[row.nutrientCode] = row.nutrientValue
          }
        }

        return okAsync(
          new Map<string, FoodMasterEnrichment>(
            [...enrichments].map(([id, enrichment]) => [
              id,
              {
                ...enrichment,
                energyKcalPerUnit:
                  enrichment.nutrition[ENERGY_KCAL_CODE] ?? null,
              },
            ]),
          ),
        )
      })
