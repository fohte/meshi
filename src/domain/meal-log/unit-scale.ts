// food_master nutrient values are stored per 100g. Continuous mass/volume units
// scale linearly against that reference; ml/l/cc assume a water-like density
// (~1 g/mL), which is accurate enough for the beverages that make up virtually
// all non-gram continuous logging. Any other unit (杯, 個, etc.) is treated as
// a whole serving, so quantity becomes a direct multiplier on the per-100g values.
// Inputs come from LLM-driven free text, so keys are matched after trim+lowercase
// (e.g. 'G' / ' ml ' still resolve). A Map (not a plain object) so an LLM-supplied
// unit like '__proto__' can't resolve to an inherited Object.prototype member.
//
// Shared between meal-log-service.ts (per-record scaling) and
// mealHistoryService.ts (aggregate scaling in SQL) so the two stay in sync.
export const GRAMS_PER_UNIT: ReadonlyMap<string, number> = new Map([
  ['g', 1],
  ['kg', 1000],
  ['mg', 0.001],
  ['ml', 1],
  ['l', 1000],
  ['cc', 1],
])

export const PER_100G_BASE = 100

export const resolveScaleMultiplier = (
  quantity: number,
  unit: string,
): number => {
  const gramsPerUnit = GRAMS_PER_UNIT.get(unit.trim().toLowerCase())
  return gramsPerUnit === undefined
    ? quantity
    : (quantity * gramsPerUnit) / PER_100G_BASE
}
