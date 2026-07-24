import { okAsync, ResultAsync } from 'neverthrow'

import type { Sql } from '@/db'
import {
  type FoodCompositionLoadError,
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

export const runSeed = (
  sql: Sql,
  options: RunSeedOptions = {},
): ResultAsync<RunSeedResult, FoodCompositionLoadError> =>
  // seedNutrientDefinitions never fails validation the way loadFoodComposition
  // does — fromSafePromise leaves an unexpected rejection (e.g. a dropped
  // connection) propagating as-is rather than wrapping it in a domain error.
  ResultAsync.fromSafePromise(seedNutrientDefinitions(sql)).andThen(() => {
    if (options.foodCompositionJsonPath === undefined) {
      return okAsync({ foodComposition: null })
    }

    return loadFoodCompositionDatasetFromFile(
      options.foodCompositionJsonPath,
    ).andThen((rows) =>
      loadFoodComposition(sql, rows, options.loadOptions).map(
        (foodComposition) => ({ foodComposition }),
      ),
    )
  })
