import type { FoodSource } from '#domain/food-master/types'

// Shared by repository.ts's normalizeAndValidate and the register_food_master
// tool's zod schema so the two layers can't silently drift apart.

export const isInvalidSourceCombination = (
  source: FoodSource,
  isEstimated: boolean,
): boolean =>
  (source === 'web_search' && isEstimated) ||
  (source === 'composition_table_estimate' && !isEstimated)

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
