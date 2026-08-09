import { z } from 'zod'

import { jstDateSchema } from '#lib/jst-date'

export const jstCalendarDateSchema = jstDateSchema

export const jstDateRangeQuerySchema = z.object({
  from: jstCalendarDateSchema,
  to: jstCalendarDateSchema,
})

export type JstDateRangeQuery = z.infer<typeof jstDateRangeQuerySchema>
