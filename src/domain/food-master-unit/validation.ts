// Both a unit's fixed-mass form (g/kg/mg) and any food-specific serving
// definition are matched against this normalization, so a unit registered
// here and a unit read back at record time never diverge over case or
// incidental whitespace.
export const normalizeUnit = (unit: string): string => unit.trim().toLowerCase()

// resolveAmountGrams (src/domain/meal-log/resolve-amount-grams.ts) never
// consults a food's own unit definitions for these: g/kg/mg convert by a
// fixed factor, and l/cc are normalized to 'ml' before the lookup. A
// food_master_unit registered under any of these keys (including 'l'/'cc'
// themselves) would be silently unreachable at record time.
const RESERVED_UNITS = new Set(['g', 'kg', 'mg', 'l', 'cc'])

export const isReservedUnit = (unit: string): boolean =>
  RESERVED_UNITS.has(normalizeUnit(unit))

// A single serving unit heavier than this isn't realistic; reject it rather
// than silently registering a mistaken value (e.g. a units mixup, or a typo
// adding an extra digit).
export const MAX_PLAUSIBLE_GRAMS_PER_UNIT = 10_000

export const isImplausibleGramsPerUnit = (gramsPerUnit: number): boolean =>
  !Number.isFinite(gramsPerUnit) ||
  gramsPerUnit <= 0 ||
  gramsPerUnit > MAX_PLAUSIBLE_GRAMS_PER_UNIT
