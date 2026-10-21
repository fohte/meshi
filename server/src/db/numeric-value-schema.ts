import { z } from 'zod'

export const numericValueSchema = z.union([
  z.number().refine(Number.isFinite),
  z.string().transform((value, context) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      context.addIssue({
        code: 'custom',
        message: `not a finite number: ${value}`,
      })
      return z.NEVER
    }
    return parsed
  }),
])
