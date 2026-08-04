import { err, ok, type Result } from 'neverthrow'

import { UnknownUnitError } from '#domain/meal-log/errors'
import { classifyUnit } from '#domain/unit/classification'

// Resolves a recorded quantity+unit to an amount expressed in the food's own
// basis unit (food_masters.basis_unit) — the sole basis for every downstream
// nutrition calculation (nutrient value / basis_quantity × this amount).
//
// The canonicalUnit === basisUnit check below covers both an exact unit
// match and a food-independent alias (e.g. recording in kg when basisUnit is
// g) in one step, because basisUnit is itself normalized to a classifyUnit
// canonical form at registration time (see food-master/repository.ts). Only
// once that fails does resolution fall back to the food's own
// food_master_units definitions. A consequence worth knowing: recording in
// grams for a food whose basisUnit isn't 'g' always fails here, since g/kg/mg
// are reserved units that can never appear in food_master_units (see
// isReservedUnit) — there is no path to fabricate a weight for a food
// registered without one.
export const resolveAmountGrams = (
  quantity: number,
  rawUnit: string,
  basisUnit: string,
  unitDefinitions: Readonly<Record<string, number>>,
): Result<number, UnknownUnitError> => {
  const classification = classifyUnit(rawUnit)

  if (classification.canonicalUnit === basisUnit) {
    return ok(quantity * classification.factorToCanonical)
  }

  const lookupUnit = classification.canonicalUnit
  const lookupQuantity = quantity * classification.factorToCanonical

  const factor = unitDefinitions[lookupUnit]
  if (factor === undefined) {
    return err(new UnknownUnitError(lookupUnit, Object.keys(unitDefinitions)))
  }
  return ok(lookupQuantity * factor)
}
