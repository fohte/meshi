// Shared by food-master/repository.ts (units passed at registration time)
// and this domain's own repository.ts (adding a unit to an existing food),
// so a unit registered through either path normalizes and validates
// identically — and matches what resolveAmountGrams looks up at record time.

// Both a unit's fixed-mass form (g/kg/mg) and any food-specific serving
// definition are matched against this normalization, so a unit registered
// here and a unit read back at record time never diverge over case or
// incidental whitespace.
export const normalizeUnit = (unit: string): string => unit.trim().toLowerCase()

// A single serving unit heavier than this isn't realistic; reject it rather
// than silently registering a mistaken value (e.g. a units mixup, or a typo
// adding an extra digit).
export const MAX_PLAUSIBLE_GRAMS_PER_UNIT = 10_000

export const isImplausibleGramsPerUnit = (gramsPerUnit: number): boolean =>
  !Number.isFinite(gramsPerUnit) ||
  gramsPerUnit <= 0 ||
  gramsPerUnit > MAX_PLAUSIBLE_GRAMS_PER_UNIT
