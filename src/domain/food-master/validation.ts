import type { FoodSource, NutritionMap } from '#domain/food-master/types'

export const isEmptyNutrition = (nutrition: NutritionMap): boolean =>
  Object.keys(nutrition).length === 0

// Used by food-master registration to validate source combinations.
export const isInvalidSourceCombination = (
  source: FoodSource,
  isEstimated: boolean,
): boolean =>
  (source === 'web_search' && isEstimated) ||
  (source === 'composition_table_estimate' && !isEstimated)

// Explains the web_search + isEstimated=true case; invalid composition table
// estimates use a separate message in normalizeAndValidate.
export const INVALID_SOURCE_COMBINATION_MESSAGE =
  "is_estimated=true must not be combined with source='web_search': this source asserts that a real, accessible page confirms these exact values for this specific product and size. If the evidence is uncertain, do not mark the values as non-estimated to bypass this check; confirm them with the user before registering them as source='user_input'."

export const hasDuplicateAfterTrim = (
  values: ReadonlyArray<string>,
): boolean => {
  const trimmed = values.map((v) => v.trim())
  return new Set(trimmed).size !== trimmed.length
}

export interface SourceEvidenceInput {
  readonly source: FoodSource
  readonly sourceUrl: string | null
  readonly sourceCompositionCode: string | null
}

export type SourceEvidenceViolation =
  | 'missing_source_url'
  | 'unexpected_source_url'
  | 'missing_composition_code'
  | 'unexpected_composition_code'

// Mirrors the evidence rules encoded by the food-master CHECK constraints in schema.ts.
export const validateSourceEvidence = (
  input: SourceEvidenceInput,
): SourceEvidenceViolation | null => {
  const { source, sourceUrl, sourceCompositionCode } = input
  if (source === 'web_search') {
    if (sourceUrl === null) return 'missing_source_url'
    if (sourceCompositionCode !== null) return 'unexpected_composition_code'
    return null
  }
  if (source === 'composition_table_estimate') {
    if (sourceCompositionCode === null) return 'missing_composition_code'
    if (sourceUrl !== null) return 'unexpected_source_url'
    return null
  }
  if (sourceUrl !== null) return 'unexpected_source_url'
  if (sourceCompositionCode !== null) return 'unexpected_composition_code'
  return null
}
