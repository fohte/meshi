import type postgres from 'postgres'

import type { NutritionMap } from '#domain/food-master/types'

// Shared by repository.ts and merge-repository.ts — pulled out to a third
// file (rather than one importing from the other) so neither has to import
// the other just for this.
export type TxSql = postgres.TransactionSql<Record<string, never>>

export const toNutritionMap = (
  rows: ReadonlyArray<{ nutrient_code: string; value: string }>,
): NutritionMap => {
  const map: Record<string, number> = {}
  for (const row of rows) {
    map[row.nutrient_code] = Number(row.value)
  }
  return map
}
