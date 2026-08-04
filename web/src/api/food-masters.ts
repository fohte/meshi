import type { ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { ApiRequestError } from '#api/errors'
import { foodSourceSchema } from '#api/foods'
import { requestJson } from '#api/request'

const registeredFoodMasterSchema = z.object({
  id: z.string(),
  name: z.string(),
  isEstimated: z.boolean(),
  source: foodSourceSchema,
  sourceUrl: z.string().nullable(),
  basisQuantity: z.number(),
  basisUnit: z.string(),
  nutritionPerBasis: z.record(z.string(), z.number()),
})

export type RegisteredFoodMaster = z.infer<typeof registeredFoodMasterSchema>

// Registers a food_master from a food_compositions row (the "新規追加候補"
// path when a meal log sheet search misses food_masters entirely).
export const registerFoodMasterFromComposition = (
  compositionCode: string,
): ResultAsync<RegisteredFoodMaster, ApiRequestError> =>
  requestJson(
    '/api/food-masters/from-composition',
    registeredFoodMasterSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ compositionCode }),
    },
  )
