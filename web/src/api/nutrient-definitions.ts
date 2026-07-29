import type { ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { ApiRequestError, ApiResponseShapeError } from '#api/errors'
import { fetchJson } from '#api/fetch-json'

const nutrientUnitSchema = z.enum(['kcal', 'g', 'mg', 'µg'])

const nutrientDefinitionSchema = z.object({
  code: z.string(),
  displayName: z.string(),
  unit: nutrientUnitSchema,
  isMajor: z.boolean(),
  sortOrder: z.number(),
})

export type NutrientDefinition = z.infer<typeof nutrientDefinitionSchema>

const nutrientDefinitionsResponseSchema = z.array(nutrientDefinitionSchema)

// Ordered isMajor desc, then sortOrder asc (see the server-side repository).
export const fetchNutrientDefinitions = (): ResultAsync<
  ReadonlyArray<NutrientDefinition>,
  ApiRequestError | ApiResponseShapeError
> => fetchJson('/api/nutrient-definitions', nutrientDefinitionsResponseSchema)
