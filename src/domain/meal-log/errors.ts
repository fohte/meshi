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
  constructor(public readonly eatenDate: string) {
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
