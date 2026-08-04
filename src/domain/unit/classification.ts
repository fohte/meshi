export const normalizeUnit = (unit: string): string => unit.trim().toLowerCase()

export type UnitKind = 'mass' | 'volume' | 'serving'

export interface UnitClassification {
  readonly kind: UnitKind
  readonly canonicalUnit: string
  readonly factorToCanonical: number
}

const MASS_FACTORS: Readonly<Record<string, number>> = {
  g: 1,
  kg: 1000,
  mg: 0.001,
}

const VOLUME_CANONICAL_UNIT = 'ml'

// Volume aliases collapse to 'ml' by a fixed factor, but — unlike mass — the
// canonical unit itself doesn't resolve to grams without a food-specific
// density (oil vs. syrup vs. water), so 'ml' is intentionally absent here.
const VOLUME_ALIAS_FACTORS: Readonly<Record<string, number>> = {
  l: 1000,
  cc: 1,
}

export const classifyUnit = (rawUnit: string): UnitClassification => {
  const unit = normalizeUnit(rawUnit)

  const massFactor = MASS_FACTORS[unit]
  if (massFactor !== undefined) {
    return { kind: 'mass', canonicalUnit: 'g', factorToCanonical: massFactor }
  }

  const volumeAliasFactor = VOLUME_ALIAS_FACTORS[unit]
  if (volumeAliasFactor !== undefined) {
    return {
      kind: 'volume',
      canonicalUnit: VOLUME_CANONICAL_UNIT,
      factorToCanonical: volumeAliasFactor,
    }
  }
  if (unit === VOLUME_CANONICAL_UNIT) {
    return { kind: 'volume', canonicalUnit: unit, factorToCanonical: 1 }
  }

  return { kind: 'serving', canonicalUnit: unit, factorToCanonical: 1 }
}

// A unit is reserved when classifyUnit alone already determines its grams
// conversion (mass), or when it's rewritten to a different canonical unit
// before any food-specific lookup happens (volume aliases l/cc → ml).
// Registering a food_master_unit under a reserved key would be silently
// unreachable at record time — see resolveAmountGrams
// (src/domain/meal-log/resolve-amount-grams.ts).
export const isReservedUnit = (rawUnit: string): boolean => {
  const classification = classifyUnit(rawUnit)
  if (classification.kind === 'mass') return true
  if (classification.kind === 'volume') {
    return normalizeUnit(rawUnit) !== classification.canonicalUnit
  }
  return false
}
