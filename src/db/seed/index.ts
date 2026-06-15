import type { Sql } from '@/db'
import {
  loadFoodComposition,
  loadFoodCompositionDatasetFromFile,
  type LoadFoodCompositionOptions,
  type LoadFoodCompositionResult,
} from '@/db/seed/food-composition'
import { seedNutrientDefinitions } from '@/db/seed/nutrient-definitions'

export * from '@/db/seed/food-composition'
export * from '@/db/seed/nutrient-definitions'

export interface RunSeedOptions {
  readonly foodCompositionJsonPath?: string
  readonly loadOptions?: LoadFoodCompositionOptions
}

export interface RunSeedResult {
  readonly foodComposition: LoadFoodCompositionResult | null
}

export const runSeed = async (
  sql: Sql,
  options: RunSeedOptions = {},
): Promise<RunSeedResult> => {
  await seedNutrientDefinitions(sql)

  if (options.foodCompositionJsonPath === undefined) {
    return { foodComposition: null }
  }

  const rows = await loadFoodCompositionDatasetFromFile(
    options.foodCompositionJsonPath,
  )
  const result = await loadFoodComposition(sql, rows, options.loadOptions)
  return { foodComposition: result }
}
