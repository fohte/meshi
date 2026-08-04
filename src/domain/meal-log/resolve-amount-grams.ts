import { err, ok, type Result } from 'neverthrow'

import { UnknownUnitError } from '#domain/meal-log/errors'
import { classifyUnit } from '#domain/unit/classification'

// Resolves a recorded quantity+unit to an amount expressed in the food's own
// basis unit (food_masters.basis_unit) — the sole basis for every downstream
// nutrition calculation (nutrient value / basis_quantity × this amount). For
// the (100, 'g') basis every pre-existing food has, this is literally grams,
// so behavior is unchanged.
//
// Resolution order, and why it's safe:
// 1. If the record's unit classifies (food-independently, via classifyUnit)
//    to the same canonical unit as the food's basis_unit, the conversion
//    needs no per-food data at all — this subsumes both "record unit equals
//    basis_unit exactly" (factor 1) and "food-independent unit alias" (e.g.
//    record in kg when basis_unit is g, canonical g both sides) in one check.
// 2. Otherwise fall back to the food's own food_master_units definitions
//    (now generalized in meaning from "grams per unit" to "basis-units per
//    unit" — same numbers, same column, just no longer assuming the basis is
//    grams).
// 3. UnknownUnitError otherwise.
//
// A key consequence: recording in grams for a food whose basis_unit isn't
// 'g' is structurally impossible (g/kg/mg are reserved units that can never
// appear in food_master_units — see isReservedUnit), so there's no way to
// fabricate a weight for a food that was registered without one.
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
