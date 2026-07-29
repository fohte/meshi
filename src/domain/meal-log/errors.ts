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

export class UnknownUnitError extends DomainError {
  constructor(
    public readonly unit: string,
    public readonly knownUnits: ReadonlyArray<string>,
  ) {
    super(
      knownUnits.length > 0
        ? `unit not defined for this food_master: ${unit} (known units: ${knownUnits.join(', ')})`
        : `unit not defined for this food_master: ${unit} (no units are registered yet)`,
      'meal_log/unknown_unit',
    )
    this.name = 'UnknownUnitError'
  }
}

export class ImplausibleQuantityError extends DomainError {
  constructor(public readonly amountGrams: number) {
    super(
      `resolved amount is implausible for a single meal: ${String(amountGrams)}g`,
      'meal_log/implausible_quantity',
    )
    this.name = 'ImplausibleQuantityError'
  }
}
