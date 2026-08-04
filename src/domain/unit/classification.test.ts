import { describe, expect, it } from 'vitest'

import {
  classifyUnit,
  isReservedUnit,
  normalizeUnit,
} from '#domain/unit/classification'

describe('normalizeUnit', () => {
  it.each([
    ['g', 'g'],
    ['G', 'g'],
    [' g ', 'g'],
    [' ML ', 'ml'],
  ])('normalizes %p to %p', (input, expected) => {
    expect(normalizeUnit(input)).toBe(expected)
  })
})

describe('classifyUnit', () => {
  it.each([
    ['g', { kind: 'mass', canonicalUnit: 'g', factorToCanonical: 1 }],
    ['kg', { kind: 'mass', canonicalUnit: 'g', factorToCanonical: 1000 }],
    ['mg', { kind: 'mass', canonicalUnit: 'g', factorToCanonical: 0.001 }],
    ['KG', { kind: 'mass', canonicalUnit: 'g', factorToCanonical: 1000 }],
    ['ml', { kind: 'volume', canonicalUnit: 'ml', factorToCanonical: 1 }],
    ['l', { kind: 'volume', canonicalUnit: 'ml', factorToCanonical: 1000 }],
    ['cc', { kind: 'volume', canonicalUnit: 'ml', factorToCanonical: 1 }],
    ['CC', { kind: 'volume', canonicalUnit: 'ml', factorToCanonical: 1 }],
    ['個', { kind: 'serving', canonicalUnit: '個', factorToCanonical: 1 }],
    ['杯', { kind: 'serving', canonicalUnit: '杯', factorToCanonical: 1 }],
  ] as const)('classifies %p as %o', (unit, expected) => {
    expect(classifyUnit(unit)).toEqual(expected)
  })
})

describe('isReservedUnit', () => {
  it.each(['g', 'kg', 'mg', 'l', 'cc', 'KG', ' mg ', 'CC'])(
    'reserves %p',
    (unit) => {
      expect(isReservedUnit(unit)).toBe(true)
    },
  )

  it.each(['ml', 'ML', '個', '杯', '本'])(
    'does not reserve %p — it still needs a food-specific definition',
    (unit) => {
      expect(isReservedUnit(unit)).toBe(false)
    },
  )
})
