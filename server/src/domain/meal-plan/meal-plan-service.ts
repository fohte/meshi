import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import {
  DuplicateMealPlanFoodMasterError,
  EmptyMealPlanItemsError,
  EmptyMealPlanReasonError,
  InvalidMealPlanDateError,
  InvalidMealPlanQuantityError,
  type MealPlanDomainError,
  MealPlanNotFoundError,
  PastMealPlanDateError,
} from '#domain/meal-plan/errors'
import type { MealPlanRepository } from '#domain/meal-plan/meal-plan-repository'
import type { MealPlan, SaveMealPlanInput } from '#domain/meal-plan/types'
import {
  isValidJstCalendarDateString,
  type JstDate,
  toJstDateString,
} from '#lib/jst-date'

export interface MealPlanService {
  save(input: SaveMealPlanInput): ResultAsync<MealPlan, MealPlanDomainError>
  list(
    periodFrom: JstDate,
    periodTo: JstDate,
  ): ResultAsync<ReadonlyArray<MealPlan>, MealPlanDomainError>
  cancel(id: string): ResultAsync<MealPlan, MealPlanDomainError>
}

export interface MealPlanServiceDeps {
  readonly repository: MealPlanRepository
  readonly now: () => Date
}

export const createMealPlanService = (
  deps: MealPlanServiceDeps,
): MealPlanService => ({
  save(input) {
    if (!isValidJstCalendarDateString(input.date)) {
      return errAsync(new InvalidMealPlanDateError(input.date))
    }
    if (input.date < toJstDateString(deps.now())) {
      return errAsync(new PastMealPlanDateError(input.date))
    }
    if (input.items.length === 0) return errAsync(new EmptyMealPlanItemsError())

    const seenFoodMasterIds = new Set<string>()
    for (const item of input.items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        return errAsync(
          new InvalidMealPlanQuantityError(item.foodMasterId, item.quantity),
        )
      }
      if (seenFoodMasterIds.has(item.foodMasterId)) {
        return errAsync(new DuplicateMealPlanFoodMasterError(item.foodMasterId))
      }
      seenFoodMasterIds.add(item.foodMasterId)
    }
    const reason = input.reason?.trim()
    if (input.reason !== undefined && reason === '') {
      return errAsync(new EmptyMealPlanReasonError())
    }
    const normalized = {
      ...input,
      ...(reason === undefined ? {} : { reason }),
    }
    return deps.repository.save(normalized)
  },
  list(periodFrom, periodTo) {
    if (
      !isValidJstCalendarDateString(periodFrom) ||
      !isValidJstCalendarDateString(periodTo)
    ) {
      return errAsync(new InvalidMealPlanDateError(`${periodFrom}/${periodTo}`))
    }
    return deps.repository.list(periodFrom, periodTo)
  },
  cancel(id) {
    return deps.repository
      .cancel(id)
      .andThen((plan) =>
        plan === null ? errAsync(new MealPlanNotFoundError(id)) : okAsync(plan),
      )
  },
})
