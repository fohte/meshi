import type { ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'

const nutrientDefinitionSchema = z.object({
  code: z.string(),
  displayName: z.string(),
  unit: z.string(),
  isMajor: z.boolean(),
  sortOrder: z.number(),
})

export type NutrientDefinition = z.infer<typeof nutrientDefinitionSchema>

export const NUTRIENT_DEFINITIONS_QUERY_KEY = ['nutrient-definitions']

// Ordered by isMajor desc, then sortOrder asc (see
// src/domain/nutrient-definition/types.ts), so the major 6 always come first.
export const fetchNutrientDefinitions = (): ResultAsync<
  ReadonlyArray<NutrientDefinition>,
  ApiRequestError
> => requestJson('/api/nutrient-definitions', z.array(nutrientDefinitionSchema))
