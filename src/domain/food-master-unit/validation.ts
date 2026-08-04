// A single serving unit heavier than this isn't realistic; reject it rather
// than silently registering a mistaken value (e.g. a units mixup, or a typo
// adding an extra digit).
export const MAX_PLAUSIBLE_GRAMS_PER_UNIT = 10_000

export const isImplausibleGramsPerUnit = (gramsPerUnit: number): boolean =>
  !Number.isFinite(gramsPerUnit) ||
  gramsPerUnit <= 0 ||
  gramsPerUnit > MAX_PLAUSIBLE_GRAMS_PER_UNIT
