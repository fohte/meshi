import type { FoodSource } from '#domain/food-master/types'

// Shared by repository.ts's normalizeAndValidate and the register_food_master
// tool's zod schema so the two layers can't silently drift apart.

export const isInvalidSourceCombination = (
  source: FoodSource,
  isEstimated: boolean,
): boolean => isEstimated && source === 'web_search'

export const hasDuplicateAfterTrim = (
  values: ReadonlyArray<string>,
): boolean => {
  const trimmed = values.map((v) => v.trim())
  return new Set(trimmed).size !== trimmed.length
}
