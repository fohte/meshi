import { describe, expect, it } from 'vitest'

import { UnknownUnitError } from '#domain/meal-log/errors'
import { resolveAmountGrams } from '#domain/meal-log/resolve-amount-grams'

describe('resolveAmountGrams', () => {
  it.each([
    ['g', 1],
    ['G', 1],
    [' g ', 1],
    ['kg', 1000],
    ['mg', 0.001],
  ])(
    'resolves the fixed mass unit %p by a food-independent factor',
    (unit, factor) => {
      const result = resolveAmountGrams(3, unit, 'g', {})
      expect(result._unsafeUnwrap()).toBe(3 * factor)
    },
  )

  it('resolves a discrete unit via the food-specific definition', () => {
    const result = resolveAmountGrams(2, '個', 'g', { 個: 55 })
    expect(result._unsafeUnwrap()).toBe(110)
  })

  it('resolves ml directly via the food-specific definition', () => {
    const result = resolveAmountGrams(600, 'ml', 'g', { ml: 1.04 })
    expect(result._unsafeUnwrap()).toBeCloseTo(624)
  })

  it('normalizes l to ml×1000 before looking up the food-specific definition', () => {
    const result = resolveAmountGrams(0.6, 'l', 'g', { ml: 1.04 })
    expect(result._unsafeUnwrap()).toBeCloseTo(624)
  })

  it('normalizes cc to ml×1 before looking up the food-specific definition', () => {
    const result = resolveAmountGrams(600, 'cc', 'g', { ml: 1.04 })
    expect(result._unsafeUnwrap()).toBeCloseTo(624)
  })

  it('rejects a unit with no fixed factor and no food-specific definition', () => {
    const error = resolveAmountGrams(1, '杯', 'g', {
      個: 55,
    })._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(UnknownUnitError)
    expect(error).toEqual(new UnknownUnitError('杯', ['個']))
  })

  it('reports the normalized ml unit (not l) as unknown when the food has no ml definition', () => {
    const error = resolveAmountGrams(0.6, 'l', 'g', {
      個: 55,
    })._unsafeUnwrapErr()
    expect(error).toEqual(new UnknownUnitError('ml', ['個']))
  })

  it('reports an empty knownUnits list when the food has no unit definitions at all', () => {
    const error = resolveAmountGrams(1, '杯', 'g', {})._unsafeUnwrapErr()
    expect(error).toEqual(new UnknownUnitError('杯', []))
  })

  it('resolves a whole-serving basis (食) via an exact unit match, with no unit definitions needed', () => {
    const result = resolveAmountGrams(1, '食', '食', {})
    expect(result._unsafeUnwrap()).toBe(1)
  })

  it('scales a whole-serving basis (食) linearly for a fractional quantity', () => {
    const result = resolveAmountGrams(0.5, '食', '食', {})
    expect(result._unsafeUnwrap()).toBe(0.5)
  })

  it('rejects recording in grams for a food whose basis is not grams', () => {
    const error = resolveAmountGrams(1, 'g', '食', {})._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(UnknownUnitError)
    expect(error).toEqual(new UnknownUnitError('g', []))
  })

  it('resolves a food_master_units-mediated conversion when the basis is not grams', () => {
    const result = resolveAmountGrams(1, '半分', '食', { 半分: 0.5 })
    expect(result._unsafeUnwrap()).toBe(0.5)
  })
})
