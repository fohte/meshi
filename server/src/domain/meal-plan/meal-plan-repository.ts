import type { ResultAsync } from 'neverthrow'

import type { MealPlanDomainError } from '#domain/meal-plan/errors'
import type { MealPlan, SaveMealPlanInput } from '#domain/meal-plan/types'
import type { JstDate } from '#lib/jst-date'

export interface MealPlanRepository {
  save(input: SaveMealPlanInput): ResultAsync<MealPlan, MealPlanDomainError>
  list(
    periodFrom: JstDate,
    periodTo: JstDate,
  ): ResultAsync<ReadonlyArray<MealPlan>, MealPlanDomainError>
  cancel(id: string): ResultAsync<MealPlan | null, MealPlanDomainError>
}
