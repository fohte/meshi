import type { FoodSource, NutritionMap } from '#domain/food-master/types'

// Shared by repository.ts's normalizeAndValidate and the register_food_master
// tool's zod schema so the two layers can't silently drift apart.

export const isEmptyNutrition = (nutrition: NutritionMap): boolean =>
  Object.keys(nutrition).length === 0

export const isInvalidSourceCombination = (
  source: FoodSource,
  isEstimated: boolean,
): boolean =>
  (source === 'web_search' && isEstimated) ||
  (source === 'composition_table_estimate' && !isEstimated)

// Specific to isInvalidSourceCombination's web_search branch (its other
// branch, composition_table_estimate + isEstimated=false, needs a different
// message — see repository.ts's normalizeAndValidate). Shared by that
// function and the register_food_master tool's zod refine, whose source enum
// excludes composition_table_estimate and so only ever hits this branch, so
// the wording can't drift between the two layers that enforce this rule.
export const INVALID_SOURCE_COMBINATION_MESSAGE =
  "is_estimated=true must not be combined with source='web_search': registering with source='web_search' asserts that a real, accessible page confirms these exact values for this specific product and size. If you are not confident the evidence matches, do not resend this call with is_estimated=false to get past this error — that discards the uncertainty instead of resolving it. Call request_user_input instead."

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

// Documents the same evidence rule the food_masters_web_search_evidence /
// food_masters_composition_evidence / food_masters_user_input_evidence DB
// CHECK constraints enforce (see schema.ts). Shared by repository.ts's
// normalizeAndValidate and the register_food_master tool's zod refine
// (which always passes sourceCompositionCode: null, since that tool never
// sets it) so the three layers can't silently drift apart.
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
