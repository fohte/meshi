import { z } from 'zod'

import { foodSourceEnum } from '#db/schema'
import { NUTRITION_VERSION_CHANGE_KINDS } from '#domain/meal-history/types'

export const nutritionVersionSchema = z.object({
  version_no: z.number().int().positive(),
  change_kind: z.enum(NUTRITION_VERSION_CHANGE_KINDS),
  source: z.enum(foodSourceEnum.enumValues),
  is_estimated: z.boolean(),
  checked_on: z.iso.date().nullable(),
  effective_from: z.iso.date().nullable(),
})

export type NutritionVersionWire = z.infer<typeof nutritionVersionSchema>
