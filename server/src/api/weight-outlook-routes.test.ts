import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { expect, it } from 'vitest'
import { z } from 'zod'

import { mountWeightOutlookRoutes } from '#api/weight-outlook-routes'
import { BodyWeightPersistenceError } from '#domain/body-weight/errors'
import type { WeightOutlook } from '#domain/weight-outlook/weight-outlook-calculator'
import type { WeightOutlookService } from '#domain/weight-outlook/weight-outlook-service'
import { jstDateSchema } from '#lib/jst-date'

const responseSchema = z.strictObject({
  asOf: jstDateSchema,
  points: z.array(
    z.strictObject({ date: jstDateSchema, weightKg: z.number() }),
  ),
  latestWeightKg: z.number().nullable(),
  goalWeightKg: z.number().nullable(),
  trend: z
    .strictObject({
      slopeKgPerDay: z.number(),
      slopeKgPerWeek: z.number(),
      points: z.array(
        z.strictObject({
          date: jstDateSchema,
          weightKg: z.number(),
          lowerKg: z.number(),
          upperKg: z.number(),
        }),
      ),
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
  arrivalDateRange: z
    .strictObject({ from: jstDateSchema, to: jstDateSchema })
    .nullable(),
})

const errorSchema = z.strictObject({ error: z.string() })

const responseSnapshot = async (response: Response) => ({
  status: response.status,
  body: z.union([responseSchema, errorSchema]).parse(await response.json()),
})

it('returns the weight outlook response from the service', async () => {
  const outlook: WeightOutlook = {
    asOf: jstDateSchema.parse('2026-11-17'),
    points: [],
    latestWeightKg: null,
    goalWeightKg: null,
    trend: null,
    status: 'insufficient_data',
    reason: 'first_measurement_too_recent',
    arrivalDateRange: null,
  }
  const service: WeightOutlookService = { get: () => okAsync(outlook) }
  const app = new Hono()
  mountWeightOutlookRoutes(app, service)

  const response = await app.request('/api/weight-outlook')
  expect(await responseSnapshot(response)).toEqual({
    status: 200,
    body: outlook,
  })
})

it('returns a server error when the service fails', async () => {
  const service: WeightOutlookService = {
    get: () => errAsync(new BodyWeightPersistenceError('outlook unavailable')),
  }
  const app = new Hono()
  mountWeightOutlookRoutes(app, service)

  const response = await app.request('/api/weight-outlook')
  expect(await responseSnapshot(response)).toEqual({
    status: 500,
    body: { error: 'outlook unavailable' },
  })
})
