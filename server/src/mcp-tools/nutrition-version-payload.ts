import type { FoodMasterNutritionVersion } from '#domain/food-master/types'

export const toFoodNutritionVersionPayload = (
  version: FoodMasterNutritionVersion,
) => ({
  nutrition_version_id: version.id,
  food_master_id: version.foodMasterId,
  version_no: version.versionNo,
  change_kind: version.changeKind,
  corrects_version_id: version.correctsVersionId,
  is_current: version.isCurrent,
  serving_basis: version.servingBasis,
  net_content: version.netContent,
  nutrition: version.nutrition,
  source: version.source,
  source_url: version.sourceUrl,
  source_composition_code: version.sourceCompositionCode,
  is_estimated: version.isEstimated,
  checked_on: version.checkedOn,
  effective_from: version.effectiveFrom,
  reason: version.reason,
  meal_log_count: version.mealLogCount,
})
