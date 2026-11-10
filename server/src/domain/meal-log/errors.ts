import type { JstDate } from '#lib/jst-date'

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export class FutureEatenDateError extends DomainError {
  constructor(public readonly eatenDate: JstDate) {
    super(
      `eaten_date must not be in the future: ${eatenDate}`,
      'meal_log/future_eaten_date',
    )
    this.name = 'FutureEatenDateError'
  }
}

export class InvalidQuantityError extends DomainError {
  constructor(public readonly quantity: number) {
    super(
      `quantity must be a finite positive number: ${String(quantity)}`,
      'meal_log/invalid_quantity',
    )
    this.name = 'InvalidQuantityError'
  }
}

export class FoodMasterNotFoundError extends DomainError {
  constructor(public readonly foodMasterId: string) {
    super(
      `food_master not found: ${foodMasterId}`,
      'meal_log/food_master_not_found',
    )
    this.name = 'FoodMasterNotFoundError'
  }
}

export class MealLogNotFoundError extends DomainError {
  constructor(public readonly id: string) {
    super(`meal_log not found: ${id}`, 'meal_log/not_found')
    this.name = 'MealLogNotFoundError'
  }
}

export class MealLogPersistenceError extends DomainError {
  constructor(message: string, cause?: unknown) {
    super(message, 'meal_log/persistence_failed')
    this.name = 'MealLogPersistenceError'
    if (cause !== undefined) this.cause = cause
  }
}

export class ImplausibleQuantityError extends DomainError {
  constructor(public readonly resolvedEnergyKcal: number) {
    super(
      `resolved nutrition is implausible for a single meal: ${String(resolvedEnergyKcal)}kcal`,
      'meal_log/implausible_quantity',
    )
    this.name = 'ImplausibleQuantityError'
  }
}

export class FoodNameMismatchError extends DomainError {
  constructor(
    public readonly providedName: string,
    public readonly actualName: string,
  ) {
    super(
      `food_name does not match the food_master this food_master_id points to: provided "${providedName}", actual "${actualName}"`,
      'meal_log/food_name_mismatch',
    )
    this.name = 'FoodNameMismatchError'
  }
}

export class MealLogItemValidationError extends DomainError {
  constructor(
    public readonly itemIndex: number,
    public readonly itemError: DomainError,
  ) {
    super(`item ${String(itemIndex)}: ${itemError.message}`, itemError.code)
    this.name = 'MealLogItemValidationError'
    this.cause = itemError
  }
}

export class MealPlanNotFoundForMealLogError extends DomainError {
  constructor(public readonly mealPlanId: string) {
    super(`meal_plan not found: ${mealPlanId}`, 'meal_plan/not_found')
    this.name = 'MealPlanNotFoundForMealLogError'
  }
}

export class CancelledMealPlanError extends DomainError {
  constructor(public readonly mealPlanId: string) {
    super(`meal_plan is cancelled: ${mealPlanId}`, 'meal_plan/cancelled')
    this.name = 'CancelledMealPlanError'
  }
}

export class MealPlanDateMismatchError extends DomainError {
  constructor(public readonly mealPlanId: string) {
    super(
      `eaten_date does not match meal_plan: ${mealPlanId}`,
      'meal_plan/date_mismatch',
    )
    this.name = 'MealPlanDateMismatchError'
  }
}

export class MealPlanMealTypeMismatchError extends DomainError {
  constructor(public readonly mealPlanId: string) {
    super(
      `meal_type does not match meal_plan: ${mealPlanId}`,
      'meal_plan/meal_type_mismatch',
    )
    this.name = 'MealPlanMealTypeMismatchError'
  }
}

export class MealPlanAlreadyEatenError extends DomainError {
  constructor(public readonly mealPlanId: string) {
    super(
      `meal_plan is already eaten: ${mealPlanId}`,
      'meal_plan/already_eaten',
    )
    this.name = 'MealPlanAlreadyEatenError'
  }
}
