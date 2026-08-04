import { err, ok, type Result } from 'neverthrow'

import { UnknownUnitError } from '#domain/meal-log/errors'
import { classifyUnit } from '#domain/unit/classification'

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
  const classification = classifyUnit(rawUnit)

  if (classification.kind === 'mass') {
    return ok(quantity * classification.factorToCanonical)
  }

  const lookupUnit = classification.canonicalUnit
  const lookupQuantity = quantity * classification.factorToCanonical

  const gramsPerUnit = unitDefinitions[lookupUnit]
  if (gramsPerUnit === undefined) {
    return err(new UnknownUnitError(lookupUnit, Object.keys(unitDefinitions)))
  }
  return ok(lookupQuantity * gramsPerUnit)
}
