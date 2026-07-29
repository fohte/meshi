import { err, ok, type Result } from 'neverthrow'

import { normalizeUnit } from '#domain/food-master-unit/validation'
import { UnknownUnitError } from '#domain/meal-log/errors'

// The unit itself denotes mass, so these convert by a fixed factor
// regardless of food — no food_master_units row is needed.
const FIXED_GRAMS_PER_UNIT: Readonly<Record<string, number>> = {
  g: 1,
  kg: 1000,
  mg: 0.001,
}

// Volume units normalize to 'ml' before consulting the food's own per-unit
// definitions: unlike g/kg/mg, 1 mL isn't a fixed mass across foods (oil vs.
// syrup vs. water), so it still needs a food-specific grams_per_unit lookup.
const VOLUME_UNIT_ALIASES: Readonly<
  Record<string, { readonly unit: string; readonly factor: number }>
> = {
  l: { unit: 'ml', factor: 1000 },
  cc: { unit: 'ml', factor: 1 },
}

// Resolves a recorded quantity+unit to the grams that will drive every
// downstream nutrition calculation, given the food's own unit definitions
// (food_master_units, keyed by normalized unit). Returns UnknownUnitError
// when the unit isn't a fixed mass unit and the food has no matching
// definition — the caller must register one before the meal can be recorded.
export const resolveAmountGrams = (
  quantity: number,
  rawUnit: string,
  unitDefinitions: Readonly<Record<string, number>>,
): Result<number, UnknownUnitError> => {
  const normalized = normalizeUnit(rawUnit)

  const fixedFactor = FIXED_GRAMS_PER_UNIT[normalized]
  if (fixedFactor !== undefined) {
    return ok(quantity * fixedFactor)
  }

  const alias = VOLUME_UNIT_ALIASES[normalized]
  const lookupUnit = alias?.unit ?? normalized
  const lookupQuantity =
    alias === undefined ? quantity : quantity * alias.factor

  const gramsPerUnit = unitDefinitions[lookupUnit]
  if (gramsPerUnit === undefined) {
    return err(new UnknownUnitError(lookupUnit, Object.keys(unitDefinitions)))
  }
  return ok(lookupQuantity * gramsPerUnit)
}
