import { and, eq, inArray } from 'drizzle-orm'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { foodCompositionNutrients } from '#db/schema'
import {
  ENERGY_KCAL_CODE,
  finiteNumeric,
  type FoodSearchDb,
} from '#domain/food-browse/food-enrichment'

class FoodCompositionEnrichmentError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'FoodCompositionEnrichmentError'
  }
}

const compositionEnergyRowsSchema = z.array(
  z.object({
    compositionCode: z.string(),
    energyKcal: finiteNumeric,
  }),
)

export const loadFoodCompositionEnergy = (
  db: FoodSearchDb,
  compositionCodes: ReadonlyArray<string>,
): ResultAsync<Map<string, number>, FoodCompositionEnrichmentError> =>
  compositionCodes.length === 0
    ? okAsync(new Map<string, number>())
    : ResultAsync.fromPromise(
        db
          .select({
            compositionCode: foodCompositionNutrients.foodCompositionCode,
            energyKcal: foodCompositionNutrients.value,
          })
          .from(foodCompositionNutrients)
          .where(
            and(
              inArray(foodCompositionNutrients.foodCompositionCode, [
                ...compositionCodes,
              ]),
              eq(foodCompositionNutrients.nutrientCode, ENERGY_KCAL_CODE),
            ),
          ),
        (caughtErr) =>
          new FoodCompositionEnrichmentError(
            'failed to load food composition energy',
            caughtErr,
          ),
      ).andThen((rows) => {
        const parsed = compositionEnergyRowsSchema.safeParse(rows)
        if (!parsed.success) {
          return errAsync(
            new FoodCompositionEnrichmentError(
              `food composition enrichment returned invalid rows: ${parsed.error.message}`,
              parsed.error,
            ),
          )
        }
        return okAsync(
          new Map(
            parsed.data.map((row) => [row.compositionCode, row.energyKcal]),
          ),
        )
      })
