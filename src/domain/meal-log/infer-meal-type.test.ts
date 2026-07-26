import { describe, expect, it } from 'vitest'

import { inferMealType } from '@/domain/meal-log/infer-meal-type'

describe('inferMealType', () => {
  it.each([
    ['2026-06-15T18:59:00.000Z', 'snack'], // 03:59 JST (just before breakfast)
    ['2026-06-15T19:00:00.000Z', 'breakfast'], // 04:00 JST
    ['2026-06-16T01:59:00.000Z', 'breakfast'], // 10:59 JST (just before lunch)
    ['2026-06-16T02:00:00.000Z', 'lunch'], // 11:00 JST
    ['2026-06-16T06:59:00.000Z', 'lunch'], // 15:59 JST (just before dinner)
    ['2026-06-16T07:00:00.000Z', 'dinner'], // 16:00 JST
    ['2026-06-16T13:59:00.000Z', 'dinner'], // 22:59 JST (just before snack)
    ['2026-06-16T14:00:00.000Z', 'snack'], // 23:00 JST
  ])('classifies %s (UTC) as %s', (iso, expected) => {
    expect(inferMealType(new Date(iso))).toBe(expected)
  })
})
