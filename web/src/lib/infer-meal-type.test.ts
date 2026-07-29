import { describe, expect, it } from 'vitest'

import { inferMealType } from '#lib/infer-meal-type'

describe('inferMealType', () => {
  it.each([
    ['04:00', 'breakfast'],
    ['10:59', 'breakfast'],
    ['11:00', 'lunch'],
    ['15:59', 'lunch'],
    ['16:00', 'dinner'],
    ['22:59', 'dinner'],
    ['23:00', 'snack'],
    ['03:59', 'snack'],
  ] as const)('infers %s as %s', (time, expected) => {
    expect(inferMealType(time)).toBe(expected)
  })
})
