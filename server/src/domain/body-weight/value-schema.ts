import { z } from 'zod'

const hasAtMostTwoDecimalPlaces = (weightKg: number): boolean => {
  const value = String(weightKg).toLowerCase()
  const [coefficient = value] = value.split('e')
  const decimalPlaces = coefficient.split('.')[1]?.length ?? 0
  return decimalPlaces <= 2
}

export const bodyWeightKgSchema = z
  .number()
  .min(20)
  .max(300)
  .refine(hasAtMostTwoDecimalPlaces)
