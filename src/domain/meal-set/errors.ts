import { CodedDomainError } from '#domain/errors'

export type MealSetErrorCode =
  | 'meal_set/empty_name'
  | 'meal_set/empty_items'
  | 'meal_set/duplicate_food_master'
  | 'meal_set/invalid_quantity'
  | 'meal_set/food_master_not_found'
  | 'meal_set/duplicate_name'
  | 'meal_set/not_found'
  | 'meal_set/persistence_failed'

export class MealSetDomainError extends CodedDomainError<MealSetErrorCode> {
  constructor(
    code: MealSetErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(code, message, details, cause)
    this.name = 'MealSetDomainError'
  }
}

export class EmptyMealSetNameError extends MealSetDomainError {
  constructor() {
    super('meal_set/empty_name', 'name must not be empty')
    this.name = 'EmptyMealSetNameError'
  }
}

export class EmptyMealSetItemsError extends MealSetDomainError {
  constructor() {
    super('meal_set/empty_items', 'items must not be empty')
    this.name = 'EmptyMealSetItemsError'
  }
}

export class DuplicateMealSetFoodMasterError extends MealSetDomainError {
  constructor(public readonly foodMasterId: string) {
    super(
      'meal_set/duplicate_food_master',
      `food_master_id must not be duplicated: ${foodMasterId}`,
      { foodMasterId },
    )
    this.name = 'DuplicateMealSetFoodMasterError'
  }
}

export class InvalidMealSetQuantityError extends MealSetDomainError {
  constructor(
    public readonly foodMasterId: string,
    public readonly quantity: number,
  ) {
    super(
      'meal_set/invalid_quantity',
      `quantity must be a finite positive number for food_master_id ${foodMasterId}: ${String(quantity)}`,
      { foodMasterId, quantity },
    )
    this.name = 'InvalidMealSetQuantityError'
  }
}

export class MealSetFoodMasterNotFoundError extends MealSetDomainError {
  constructor(public readonly foodMasterId: string) {
    super(
      'meal_set/food_master_not_found',
      `food_master not found: ${foodMasterId}`,
      { foodMasterId },
    )
    this.name = 'MealSetFoodMasterNotFoundError'
  }
}

export class DuplicateMealSetNameError extends MealSetDomainError {
  constructor(
    public readonly nameValue: string,
    cause?: unknown,
  ) {
    super(
      'meal_set/duplicate_name',
      `meal_set with name already exists: ${nameValue}`,
      { name: nameValue },
      cause,
    )
    this.name = 'DuplicateMealSetNameError'
  }
}

export class MealSetNotFoundError extends MealSetDomainError {
  constructor(public readonly id: string) {
    super('meal_set/not_found', `meal_set not found: ${id}`, { id })
    this.name = 'MealSetNotFoundError'
  }
}

export class MealSetPersistenceError extends MealSetDomainError {
  constructor(message: string, cause?: unknown) {
    super('meal_set/persistence_failed', message, {}, cause)
    this.name = 'MealSetPersistenceError'
  }
}
