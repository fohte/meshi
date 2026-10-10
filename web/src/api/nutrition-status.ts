import { z } from 'zod'

export const nutritionStatusSchema = z.enum([
  'confirmed',
  'estimated',
  'unknown',
])
