import type { UseQueryResult } from '@tanstack/react-query'
import { z } from 'zod'

import type { ApiRequestError } from '#api/fetch-json'
import { fetchJson } from '#api/fetch-json'
import { useResultQuery } from '#api/use-result-query'

const nutrientDefinitionSchema = z.object({
  code: z.string(),
  displayName: z.string(),
  unit: z.enum(['kcal', 'g', 'mg', 'µg']),
  isMajor: z.boolean(),
  sortOrder: z.number(),
})

export type NutrientDefinition = z.infer<typeof nutrientDefinitionSchema>

const nutrientDefinitionsSchema = z.array(nutrientDefinitionSchema)

// Ordered isMajor desc, sortOrder asc by the repository — effectively
// static reference data, so it's fetched once and never refetched.
export const useNutrientDefinitions = (): UseQueryResult<
  ReadonlyArray<NutrientDefinition>,
  ApiRequestError
> =>
  useResultQuery(
    ['nutrient-definitions'],
    () => fetchJson('/api/nutrient-definitions', nutrientDefinitionsSchema),
    { staleTime: Infinity },
  )
