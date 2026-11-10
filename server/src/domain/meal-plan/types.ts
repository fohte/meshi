import type { MealType } from '#domain/meal-log/types'
import type { JstDate } from '#lib/jst-date'

interface MealPlanItemInput {
  readonly foodMasterId: string
  readonly foodName: string
  readonly quantity: number
}

export interface MealPlanItem extends MealPlanItemInput {
  readonly energyKcalPerUnit: number | null
}

export interface MealPlan {
  readonly id: string
  readonly date: JstDate
  readonly mealType: MealType
  readonly items: ReadonlyArray<MealPlanItem>
  readonly reason: string | null
  readonly status: 'planned' | 'eaten' | 'cancelled'
  readonly createdAt: Date
}

export interface SaveMealPlanInput {
  readonly date: JstDate
  readonly mealType: MealType
  readonly items: ReadonlyArray<MealPlanItemInput>
  readonly reason?: string
}
