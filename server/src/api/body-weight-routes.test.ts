import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { z } from 'zod'

import { mountBodyWeightRoutes } from '#api/body-weight-routes'
import { createBodyWeightService } from '#domain/body-weight/body-weight-service'
import { createDrizzleBodyWeightRepository } from '#domain/body-weight/drizzle-body-weight-repository'
import { jstDateSchema } from '#lib/jst-date'
import { describeIfDb, setupDrizzleTx } from '#test/db'

const NOW = new Date('2026-11-16T12:00:00.000Z')
const responseRowSchema = z.strictObject({
  id: z.string(),
  date: jstDateSchema,
  measuredAt: z.iso.datetime({ offset: true }).nullable(),
  weightKg: z.number(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})
const responseErrorSchema = z.strictObject({ error: z.string() })
const captureOutput = <Output>(output: Output): Output => output

const createTestApp = (sql: ReturnType<ReturnType<typeof setupDrizzleTx>>) => {
  const service = createBodyWeightService({
    repository: createDrizzleBodyWeightRepository(sql),
    idGenerator: (() => {
      let nextId = 0
      return () => `body_weight_${String(++nextId)}`
    })(),
    now: () => NOW,
  })
  const app = new Hono()
  mountBodyWeightRoutes(app, service)
  return app
}

const requestJson = (
  app: Hono,
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> =>
  Promise.resolve(
    app.request(path, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
    }),
  )

const normalizeRow = (row: Record<string, unknown>) => ({
  ...row,
  createdAt: '<timestamp>',
  updatedAt: '<timestamp>',
})

describeIfDb('body weight API routes', () => {
  const getTx = setupDrizzleTx()

  it('records, lists, corrects, and deletes body weights', async () => {
    const app = createTestApp(getTx())
    const firstResponse = await requestJson(app, '/api/body-weights', 'POST', {
      date: '2026-11-16',
      weightKg: 70.25,
    })
    const first = responseRowSchema.parse(await firstResponse.json())
    const resendResponse = await requestJson(app, '/api/body-weights', 'POST', {
      date: '2026-11-16',
      weightKg: 70.25,
    })
    const resend = responseRowSchema.parse(await resendResponse.json())
    const secondResponse = await requestJson(app, '/api/body-weights', 'POST', {
      date: '2026-11-16',
      weightKg: 69.75,
      measuredAt: '2026-11-16T08:00:00+09:00',
    })
    const second = responseRowSchema.parse(await secondResponse.json())
    const pastResponse = await requestJson(app, '/api/body-weights', 'POST', {
      date: '2025-01-02',
      weightKg: 71,
    })
    const past = responseRowSchema.parse(await pastResponse.json())

    const recording = [
      firstResponse.status,
      normalizeRow(first),
      resendResponse.status,
      normalizeRow(resend),
      secondResponse.status,
      normalizeRow(second),
      pastResponse.status,
      normalizeRow(past),
    ]
    const expectedRecording = [
      201,
      {
        id: 'body_weight_1',
        date: '2026-11-16',
        measuredAt: null,
        weightKg: 70.25,
        createdAt: '<timestamp>',
        updatedAt: '<timestamp>',
      },
      201,
      {
        id: 'body_weight_1',
        date: '2026-11-16',
        measuredAt: null,
        weightKg: 70.25,
        createdAt: '<timestamp>',
        updatedAt: '<timestamp>',
      },
      201,
      {
        id: 'body_weight_3',
        date: '2026-11-16',
        measuredAt: '2026-11-15T23:00:00.000Z',
        weightKg: 69.75,
        createdAt: '<timestamp>',
        updatedAt: '<timestamp>',
      },
      201,
      {
        id: 'body_weight_4',
        date: '2025-01-02',
        measuredAt: null,
        weightKg: 71,
        createdAt: '<timestamp>',
        updatedAt: '<timestamp>',
      },
    ]

    const listResponse = await app.request(
      '/api/body-weights?from=2025-01-01&to=2026-11-16',
    )
    const list = z.array(responseRowSchema).parse(await listResponse.json())
    const listing = [listResponse.status, list.map(normalizeRow)]
    const expectedListing = [
      200,
      [normalizeRow(second), normalizeRow(first), normalizeRow(past)],
    ]

    const collisionResponse = await requestJson(
      app,
      `/api/body-weights/${second.id}`,
      'PATCH',
      { measuredAt: null, weightKg: 70.25 },
    )
    const collision = [
      collisionResponse.status,
      responseErrorSchema.parse(await collisionResponse.json()),
    ]

    const correctedResponse = await requestJson(
      app,
      `/api/body-weights/${second.id}`,
      'PATCH',
      { measuredAt: null, weightKg: 69.5 },
    )
    const corrected = responseRowSchema.parse(await correctedResponse.json())
    const correction = [correctedResponse.status, normalizeRow(corrected)]
    const expectedCorrection = [
      200,
      {
        ...normalizeRow(second),
        measuredAt: null,
        weightKg: 69.5,
      },
    ]

    const deleteResponse = await requestJson(
      app,
      `/api/body-weights/${past.id}`,
      'DELETE',
    )
    const missingResponse = await requestJson(
      app,
      '/api/body-weights/missing',
      'DELETE',
    )
    const deletion = [
      deleteResponse.status,
      missingResponse.status,
      responseErrorSchema.parse(await missingResponse.json()),
    ]

    const actual = captureOutput({
      recording,
      listing,
      collision,
      correction,
      deletion,
    })
    expect(actual).toEqual({
      recording: expectedRecording,
      listing: expectedListing,
      collision: [
        409,
        { error: 'body weight conflicts with another measurement' },
      ],
      correction: expectedCorrection,
      deletion: [204, 404, { error: 'body weight not found: missing' }],
    })
  })

  it('rejects invalid dates, future dates, and invalid values', async () => {
    const app = createTestApp(getTx())
    const requests = await Promise.all([
      requestJson(app, '/api/body-weights', 'POST', {
        date: '2026-02-30',
        weightKg: 70,
      }),
      requestJson(app, '/api/body-weights', 'POST', {
        date: '2026-11-17',
        weightKg: 70,
      }),
      requestJson(app, '/api/body-weights', 'POST', {
        date: '2026-11-16',
        weightKg: 19.99,
      }),
      requestJson(app, '/api/body-weights', 'POST', {
        date: '2026-11-16',
        weightKg: 300.01,
      }),
      requestJson(app, '/api/body-weights', 'POST', {
        date: '2026-11-16',
        weightKg: 70.001,
      }),
      requestJson(app, '/api/body-weights', 'POST', {
        date: '2026-11-16',
        weightKg: 70,
        measuredAt: '2026-11-16T00:00:00+14:00',
      }),
      app.request('/api/body-weights?from=2026-11-17&to=2026-11-16'),
    ])
    const errors = z
      .array(responseErrorSchema)
      .parse(await Promise.all(requests.map((response) => response.json())))

    expect(
      requests.map((response, index) => [response.status, errors[index]]),
    ).toEqual([
      [
        400,
        {
          error:
            'must be a valid YYYY-MM-DD JST calendar date, got: "2026-02-30"',
        },
      ],
      [400, { error: 'body weight date is in the future: 2026-11-17' }],
      [
        400,
        {
          error:
            'weightKg must be between 20 and 300 kg with at most 2 decimal places: 19.99',
        },
      ],
      [
        400,
        {
          error:
            'weightKg must be between 20 and 300 kg with at most 2 decimal places: 300.01',
        },
      ],
      [
        400,
        {
          error:
            'weightKg must be between 20 and 300 kg with at most 2 decimal places: 70.001',
        },
      ],
      [400, { error: 'measuredAt must fall on the body weight date in JST' }],
      [400, { error: 'from must be on or before to' }],
    ])
  })
})
