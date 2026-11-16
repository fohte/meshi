import { z } from 'zod'

import { jstDateSchema } from '#lib/jst-date'

const weightOutlookPoint = z.object({
  date: jstDateSchema,
  weight_kg: z.number(),
})

const weightOutlookTrendPoint = weightOutlookPoint.extend({
  lower_kg: z.number(),
  upper_kg: z.number(),
})

export const weightOutlookStructuredOutput = z.object({
  as_of: jstDateSchema,
  points: z.array(weightOutlookPoint),
  latest_weight_kg: z.number().nullable(),
  goal_weight_kg: z.number().nullable(),
  trend: z
    .object({
      slope_kg_per_day: z.number(),
      slope_kg_per_week: z.number(),
      points: z.array(weightOutlookTrendPoint),
    })
    .nullable(),
  status: z.enum([
    'insufficient_data',
    'no_goal',
    'reached',
    'not_approaching',
    'no_arrival_estimate',
    'arrival_estimate',
  ]),
  reason: z
    .enum([
      'first_measurement_too_recent',
      'too_few_measurement_days',
      'measurement_gap',
    ])
    .nullable(),
  arrival_date_range: z
    .object({ from: jstDateSchema, to: jstDateSchema })
    .nullable(),
})
