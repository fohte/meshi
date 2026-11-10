import { CodedDomainError } from '#domain/errors'

export type MealPlanErrorCode =
  | 'meal_plan/invalid_date'
  | 'meal_plan/past_date'
  | 'meal_plan/empty_items'
  | 'meal_plan/duplicate_food_master'
  | 'meal_plan/invalid_quantity'
  | 'meal_plan/empty_reason'
  | 'meal_plan/food_master_not_found'
  | 'meal_plan/food_name_mismatch'
  | 'meal_plan/not_found'
  | 'meal_plan/already_eaten'
  | 'meal_plan/persistence_failed'

export class MealPlanDomainError extends CodedDomainError<MealPlanErrorCode> {
  constructor(
    code: MealPlanErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(code, message, details, cause)
    this.name = 'MealPlanDomainError'
  }
}

export class InvalidMealPlanDateError extends MealPlanDomainError {
  constructor(date: string) {
    super('meal_plan/invalid_date', `invalid planned date: ${date}`, { date })
    this.name = 'InvalidMealPlanDateError'
  }
}

export class PastMealPlanDateError extends MealPlanDomainError {
  constructor(date: string) {
    super(
      'meal_plan/past_date',
      `planned date must not be before today: ${date}`,
      { date },
    )
    this.name = 'PastMealPlanDateError'
  }
}

export class EmptyMealPlanItemsError extends MealPlanDomainError {
  constructor() {
    super('meal_plan/empty_items', 'items must not be empty')
    this.name = 'EmptyMealPlanItemsError'
  }
}

export class DuplicateMealPlanFoodMasterError extends MealPlanDomainError {
  constructor(foodMasterId: string) {
    super(
      'meal_plan/duplicate_food_master',
      `food_master_id must not be duplicated: ${foodMasterId}`,
      { foodMasterId },
    )
    this.name = 'DuplicateMealPlanFoodMasterError'
  }
}

export class InvalidMealPlanQuantityError extends MealPlanDomainError {
  constructor(foodMasterId: string, quantity: number) {
    super(
      'meal_plan/invalid_quantity',
      `quantity must be a finite positive number for food_master_id ${foodMasterId}: ${String(quantity)}`,
      { foodMasterId, quantity },
    )
    this.name = 'InvalidMealPlanQuantityError'
  }
}

export class EmptyMealPlanReasonError extends MealPlanDomainError {
  constructor() {
    super('meal_plan/empty_reason', 'reason must not be empty')
    this.name = 'EmptyMealPlanReasonError'
  }
}

export class MealPlanFoodMasterNotFoundError extends MealPlanDomainError {
  constructor(foodMasterId: string) {
    super(
      'meal_plan/food_master_not_found',
      `food_master not found: ${foodMasterId}`,
      { foodMasterId },
    )
    this.name = 'MealPlanFoodMasterNotFoundError'
  }
}

export class MealPlanFoodNameMismatchError extends MealPlanDomainError {
  constructor(providedName: string, actualName: string) {
    super(
      'meal_plan/food_name_mismatch',
      `food_name does not match food_master_id: provided "${providedName}", actual "${actualName}"`,
      { providedName, actualName },
    )
    this.name = 'MealPlanFoodNameMismatchError'
  }
}

export class MealPlanNotFoundError extends MealPlanDomainError {
  constructor(id: string) {
    super('meal_plan/not_found', `meal_plan not found: ${id}`, { id })
    this.name = 'MealPlanNotFoundError'
  }
}

export class EatenMealPlanError extends MealPlanDomainError {
  constructor(id: string) {
    super('meal_plan/already_eaten', `meal_plan is already eaten: ${id}`, {
      id,
    })
    this.name = 'EatenMealPlanError'
  }
}

export class MealPlanPersistenceError extends MealPlanDomainError {
  constructor(message: string, cause?: unknown) {
    super('meal_plan/persistence_failed', message, {}, cause)
    this.name = 'MealPlanPersistenceError'
  }
}
