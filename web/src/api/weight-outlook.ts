import type { ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'

const weightOutlookDateSchema = z.iso.date()

const weightOutlookPointSchema = z.object({
  date: weightOutlookDateSchema,
  weightKg: z.number(),
})

const weightOutlookTrendPointSchema = z.object({
  date: weightOutlookDateSchema,
  weightKg: z.number(),
  lowerKg: z.number(),
  upperKg: z.number(),
})

const weightOutlookStatusSchema = z.enum([
  'insufficient_data',
  'no_goal',
  'reached',
  'not_approaching',
  'no_arrival_estimate',
  'arrival_estimate',
])

const weightOutlookReasonSchema = z.enum([
  'first_measurement_too_recent',
  'too_few_measurement_days',
  'measurement_gap',
])

const weightOutlookSchema = z.object({
  asOf: weightOutlookDateSchema,
  points: z.array(weightOutlookPointSchema),
  latestWeightKg: z.number().nullable(),
  goalWeightKg: z.number().nullable(),
  trend: z
    .object({
      slopeKgPerDay: z.number(),
      slopeKgPerWeek: z.number(),
      points: z.array(weightOutlookTrendPointSchema),
    })
    .nullable(),
  status: weightOutlookStatusSchema,
  reason: weightOutlookReasonSchema.nullable(),
  arrivalDateRange: z
    .object({
      from: weightOutlookDateSchema,
      to: weightOutlookDateSchema,
    })
    .nullable(),
})

export type WeightOutlook = z.infer<typeof weightOutlookSchema>

export const WEIGHT_OUTLOOK_QUERY_KEY = ['weight-outlook']

export const fetchWeightOutlook = (): ResultAsync<
  WeightOutlook,
  ApiRequestError
> => requestJson('/api/weight-outlook', weightOutlookSchema)
