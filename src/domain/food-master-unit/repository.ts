import { drizzle } from 'drizzle-orm/postgres-js'
import { err, errAsync, ok, ResultAsync } from 'neverthrow'

import type { Sql } from '#db/index'
import { isForeignKeyViolation, isUniqueViolation } from '#db/pg-error'
import { foodMasterUnits } from '#db/schema'
import { FoodMasterUnitDomainError } from '#domain/food-master-unit/errors'
import type {
  FoodMasterUnit,
  RegisterFoodMasterUnitInput,
} from '#domain/food-master-unit/types'
import {
  isImplausibleGramsPerUnit,
  normalizeUnit,
} from '#domain/food-master-unit/validation'

export interface FoodMasterUnitRepository {
  register(
    input: RegisterFoodMasterUnitInput,
  ): ResultAsync<FoodMasterUnit, FoodMasterUnitDomainError>
}

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

const toRegisterError = (
  caughtErr: unknown,
  foodMasterId: string,
  unit: string,
): FoodMasterUnitDomainError => {
  if (isForeignKeyViolation(caughtErr)) {
    return new FoodMasterUnitDomainError(
      'food_master_not_found',
      `food_master not found: ${foodMasterId}`,
      { foodMasterId },
      caughtErr,
    )
  }
  if (isUniqueViolation(caughtErr)) {
    return new FoodMasterUnitDomainError(
      'duplicate_unit',
      `unit already defined for this food_master: ${unit}`,
      { foodMasterId, unit },
      caughtErr,
    )
  }
  return new FoodMasterUnitDomainError(
    'persistence_failed',
    errorMessage(caughtErr),
    {},
    caughtErr,
  )
}

export const createFoodMasterUnitRepository = (
  sql: Sql,
): FoodMasterUnitRepository => {
  const db = drizzle(sql)

  return {
    register(input) {
      const unit = normalizeUnit(input.unit)
      if (unit === '') {
        return errAsync(
          new FoodMasterUnitDomainError(
            'empty_unit',
            'unit must not be empty string',
          ),
        )
      }
      if (isImplausibleGramsPerUnit(input.gramsPerUnit)) {
        return errAsync(
          new FoodMasterUnitDomainError(
            'implausible_grams_per_unit',
            `grams_per_unit must be a plausible positive mass (unit=${unit}, gramsPerUnit=${String(input.gramsPerUnit)})`,
            { unit, gramsPerUnit: input.gramsPerUnit },
          ),
        )
      }

      return ResultAsync.fromPromise(
        db
          .insert(foodMasterUnits)
          .values({
            foodMasterId: input.foodMasterId,
            unit,
            gramsPerUnit: input.gramsPerUnit.toString(),
          })
          .returning(),
        (caughtErr) => toRegisterError(caughtErr, input.foodMasterId, unit),
      ).andThen((rows) => {
        const inserted = rows[0]
        if (inserted === undefined) {
          return err(
            new FoodMasterUnitDomainError(
              'persistence_failed',
              'food_master_units insert returned no rows',
            ),
          )
        }
        return ok({
          foodMasterId: inserted.foodMasterId,
          unit: inserted.unit,
          gramsPerUnit: Number(inserted.gramsPerUnit),
        })
      })
    },
  }
}
