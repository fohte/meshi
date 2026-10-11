import { err, ok, type Result } from 'neverthrow'

import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { FoodSource, NutritionMap } from '#domain/food-master/types'

const isEmptyNutrition = (nutrition: NutritionMap): boolean =>
  Object.keys(nutrition).length === 0

// Used by food-master registration to validate source combinations.
const isInvalidSourceCombination = (
  source: FoodSource,
  isEstimated: boolean,
): boolean =>
  (source === 'web_search' && isEstimated) ||
  (source === 'composition_table_estimate' && !isEstimated)

// Explains the web_search + isEstimated=true case; invalid composition table
// estimates use a separate message in normalizeAndValidate.
const INVALID_SOURCE_COMBINATION_MESSAGE =
  "is_estimated=true must not be combined with source='web_search': this source asserts that a real, accessible page confirms these exact values for this specific product and size. If the evidence is uncertain, do not mark the values as non-estimated to bypass this check; confirm them with the user before registering them as source='user_input'."

export const hasDuplicateAfterTrim = (
  values: ReadonlyArray<string>,
): boolean => {
  const trimmed = values.map((v) => v.trim())
  return new Set(trimmed).size !== trimmed.length
}

interface SourceEvidenceInput {
  readonly source: FoodSource
  readonly sourceUrl: string | null
  readonly sourceCompositionCode: string | null
}

type SourceEvidenceViolation =
  | 'missing_source_url'
  | 'unexpected_source_url'
  | 'missing_composition_code'
  | 'unexpected_composition_code'

// Mirrors the evidence rules encoded by the food-master CHECK constraints in schema.ts.
const validateSourceEvidence = (
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

export interface NormalizedNutritionInput {
  readonly nutrition: NutritionMap
  readonly source: FoodSource
  readonly isEstimated: boolean
  readonly sourceUrl: string | null
  readonly sourceCompositionCode: string | null
}

const SOURCE_EVIDENCE_VIOLATION_MESSAGE: Record<
  SourceEvidenceViolation,
  string
> = {
  missing_source_url: "source='web_search' requires sourceUrl",
  unexpected_source_url: "sourceUrl must not be set unless source='web_search'",
  missing_composition_code:
    "source='composition_table_estimate' requires sourceCompositionCode",
  unexpected_composition_code:
    "sourceCompositionCode must not be set unless source='composition_table_estimate'",
}

export const normalizeAndValidateNutrition = (input: {
  readonly nutrition: NutritionMap
  readonly source: FoodSource
  readonly isEstimated: boolean
  readonly sourceUrl?: string
  readonly sourceCompositionCode?: string
}): Result<NormalizedNutritionInput, FoodMasterDomainError> => {
  if (isInvalidSourceCombination(input.source, input.isEstimated)) {
    return err(
      new FoodMasterDomainError(
        'invalid_source_combination',
        input.source === 'web_search'
          ? INVALID_SOURCE_COMBINATION_MESSAGE
          : "source='composition_table_estimate' requires is_estimated=true",
        { source: input.source, isEstimated: input.isEstimated },
      ),
    )
  }
  const sourceUrl = input.sourceUrl ?? null
  const sourceCompositionCode = input.sourceCompositionCode ?? null
  const evidenceViolation = validateSourceEvidence({
    source: input.source,
    sourceUrl,
    sourceCompositionCode,
  })
  if (evidenceViolation !== null) {
    return err(
      new FoodMasterDomainError(
        evidenceViolation,
        SOURCE_EVIDENCE_VIOLATION_MESSAGE[evidenceViolation],
        { source: input.source, sourceUrl, sourceCompositionCode },
      ),
    )
  }
  if (isEmptyNutrition(input.nutrition)) {
    return err(
      new FoodMasterDomainError(
        'empty_nutrition',
        'nutrition must include at least one nutrient value',
      ),
    )
  }
  for (const [code, value] of Object.entries(input.nutrition)) {
    if (!Number.isFinite(value) || value < 0) {
      return err(
        new FoodMasterDomainError(
          'negative_nutrient_value',
          `nutrient value must be a non-negative finite number (code=${code}, value=${String(value)})`,
          { code, value },
        ),
      )
    }
  }
  return ok({
    nutrition: input.nutrition,
    source: input.source,
    isEstimated: input.isEstimated,
    sourceUrl,
    sourceCompositionCode,
  })
}
