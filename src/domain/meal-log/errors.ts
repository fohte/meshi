export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export class FutureEatenAtError extends DomainError {
  constructor(public readonly eatenAt: Date) {
    super(
      `eaten_at must not be in the future: ${eatenAt.toISOString()}`,
      'meal_log/future_eaten_at',
    )
    this.name = 'FutureEatenAtError'
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

export class ImplausibleQuantityError extends DomainError {
  constructor(
    public readonly quantity: number,
    public readonly unit: string,
    public readonly scaleMultiplier: number,
  ) {
    super(
      `quantity ${String(quantity)} ${unit} scales food_master's per-100g nutrition by ${String(scaleMultiplier)}x, which is outside the plausible range for a single meal log entry`,
      'meal_log/implausible_quantity',
    )
    this.name = 'ImplausibleQuantityError'
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

export class MealLogPersistenceError extends DomainError {
  constructor(message: string, cause?: unknown) {
    super(message, 'meal_log/persistence_failed')
    this.name = 'MealLogPersistenceError'
    if (cause !== undefined) this.cause = cause
  }
}
