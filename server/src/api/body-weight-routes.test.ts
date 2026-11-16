import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { z } from 'zod'

import { mountBodyWeightRoutes } from '#api/body-weight-routes'
import { createBodyWeightService } from '#domain/body-weight/body-weight-service'
import { createDrizzleBodyWeightRepository } from '#domain/body-weight/drizzle-body-weight-repository'
import { jstDateSchema } from '#lib/jst-date'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import { seedBodyWeight } from '#test/seed'

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

const normalizeRow = (row: z.infer<typeof responseRowSchema>) => ({
  ...row,
  createdAt: '<timestamp>',
  updatedAt: '<timestamp>',
})

describeIfDb('body weight API routes', () => {
  const getTx = setupDrizzleTx()

  it('records multiple measurements, accepts past dates, and handles resends', async () => {
    const tx = getTx()
    const app = createTestApp(tx)
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
    const persistedIds = await tx<{ id: string }[]>`
      SELECT id FROM body_weights ORDER BY id
    `
    const firstMeasurementDate = (
      await createDrizzleBodyWeightRepository(tx).firstMeasurementDate()
    )._unsafeUnwrap()

    expect(
      captureOutput({
        responses: [
          firstResponse.status,
          normalizeRow(first),
          resendResponse.status,
          normalizeRow(resend),
          secondResponse.status,
          normalizeRow(second),
          pastResponse.status,
          normalizeRow(past),
        ],
        persistedIds: persistedIds.map(({ id }) => id),
        firstMeasurementDate,
      }),
    ).toEqual({
      responses: [
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
      ],
      persistedIds: ['body_weight_1', 'body_weight_3', 'body_weight_4'],
      firstMeasurementDate: '2025-01-02',
    })
  })

  it('lists records in an inclusive range ordered by date and measurement time', async () => {
    const tx = getTx()
    await seedBodyWeight(tx, {
      id: 'body_weight_morning',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: new Date('2026-11-16T00:00:00.000Z'),
      weightKg: 70,
    })
    await seedBodyWeight(tx, {
      id: 'body_weight_evening',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: new Date('2026-11-16T03:00:00.000Z'),
      weightKg: 69.9,
    })
    await seedBodyWeight(tx, {
      id: 'body_weight_unknown_time',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: null,
      weightKg: 70.1,
    })
    await seedBodyWeight(tx, {
      id: 'body_weight_past',
      measuredDate: jstDate('2025-01-02'),
      measuredAt: null,
      weightKg: 71,
    })
    const app = createTestApp(tx)
    const response = await app.request(
      '/api/body-weights?from=2025-01-02&to=2026-11-16',
    )
    const rows = z.array(responseRowSchema).parse(await response.json())

    expect(
      captureOutput({ status: response.status, rows: rows.map(normalizeRow) }),
    ).toEqual({
      status: 200,
      rows: [
        {
          id: 'body_weight_evening',
          date: '2026-11-16',
          measuredAt: '2026-11-16T03:00:00.000Z',
          weightKg: 69.9,
          createdAt: '<timestamp>',
          updatedAt: '<timestamp>',
        },
        {
          id: 'body_weight_morning',
          date: '2026-11-16',
          measuredAt: '2026-11-16T00:00:00.000Z',
          weightKg: 70,
          createdAt: '<timestamp>',
          updatedAt: '<timestamp>',
        },
        {
          id: 'body_weight_unknown_time',
          date: '2026-11-16',
          measuredAt: null,
          weightKg: 70.1,
          createdAt: '<timestamp>',
          updatedAt: '<timestamp>',
        },
        {
          id: 'body_weight_past',
          date: '2025-01-02',
          measuredAt: null,
          weightKg: 71,
          createdAt: '<timestamp>',
          updatedAt: '<timestamp>',
        },
      ],
    })
  })

  it('corrects provided fields and preserves omitted fields', async () => {
    const tx = getTx()
    await seedBodyWeight(tx, {
      id: 'body_weight_partial',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: new Date('2026-11-16T06:00:00.000Z'),
      weightKg: 70,
    })
    const app = createTestApp(tx)
    const response = await requestJson(
      app,
      '/api/body-weights/body_weight_partial',
      'PATCH',
      { weightKg: 69.75 },
    )
    const row = responseRowSchema.parse(await response.json())

    expect(
      captureOutput({ status: response.status, row: normalizeRow(row) }),
    ).toEqual({
      status: 200,
      row: {
        id: 'body_weight_partial',
        date: '2026-11-16',
        measuredAt: '2026-11-16T06:00:00.000Z',
        weightKg: 69.75,
        createdAt: '<timestamp>',
        updatedAt: '<timestamp>',
      },
    })
  })

  it('clears the measurement time when PATCH receives null', async () => {
    const tx = getTx()
    await seedBodyWeight(tx, {
      id: 'body_weight_clear_time',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: new Date('2026-11-16T06:00:00.000Z'),
      weightKg: 70,
    })
    const app = createTestApp(tx)
    const response = await requestJson(
      app,
      '/api/body-weights/body_weight_clear_time',
      'PATCH',
      { measuredAt: null },
    )
    const row = responseRowSchema.parse(await response.json())

    expect(
      captureOutput({ status: response.status, row: normalizeRow(row) }),
    ).toEqual({
      status: 200,
      row: {
        id: 'body_weight_clear_time',
        date: '2026-11-16',
        measuredAt: null,
        weightKg: 70,
        createdAt: '<timestamp>',
        updatedAt: '<timestamp>',
      },
    })
  })

  it('returns a conflict when a correction duplicates another record', async () => {
    const tx = getTx()
    await seedBodyWeight(tx, {
      id: 'body_weight_duplicate_target',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: null,
      weightKg: 70.25,
    })
    await seedBodyWeight(tx, {
      id: 'body_weight_duplicate_source',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: null,
      weightKg: 69.5,
    })
    const app = createTestApp(tx)
    const response = await requestJson(
      app,
      '/api/body-weights/body_weight_duplicate_source',
      'PATCH',
      { weightKg: 70.25 },
    )
    const error = responseErrorSchema.parse(await response.json())

    expect(captureOutput({ status: response.status, error })).toEqual({
      status: 409,
      error: { error: 'body weight conflicts with another measurement' },
    })
  })

  it('deletes an existing measurement', async () => {
    const tx = getTx()
    await seedBodyWeight(tx, {
      id: 'body_weight_delete',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: null,
      weightKg: 70,
    })
    const app = createTestApp(tx)
    const response = await requestJson(
      app,
      '/api/body-weights/body_weight_delete',
      'DELETE',
    )

    expect(captureOutput(response.status)).toEqual(204)
  })

  it('returns not found when deleting a missing measurement', async () => {
    const app = createTestApp(getTx())
    const response = await requestJson(
      app,
      '/api/body-weights/missing',
      'DELETE',
    )
    const error = responseErrorSchema.parse(await response.json())

    expect(captureOutput({ status: response.status, error })).toEqual({
      status: 404,
      error: { error: 'body weight not found: missing' },
    })
  })

  it('rejects invalid dates, future dates, and invalid weight values', async () => {
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
        measuredAt: '2026-11-16T12:00:00.001Z',
      }),
      requestJson(app, '/api/body-weights', 'POST', {
        date: '2026-11-16',
        weightKg: 70,
        measuredAt: '2026-11-16T00:00:00+14:00',
      }),
    ])
    const errors = z
      .array(responseErrorSchema)
      .parse(await Promise.all(requests.map((response) => response.json())))

    expect(
      captureOutput(
        requests.map((response, index) => [response.status, errors[index]]),
      ),
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
      [400, { error: 'measuredAt must not be in the future' }],
      [400, { error: 'measuredAt must fall on the body weight date in JST' }],
    ])
  })

  it('rejects a reversed date range', async () => {
    const app = createTestApp(getTx())
    const response = await app.request(
      '/api/body-weights?from=2026-11-17&to=2026-11-16',
    )
    const error = responseErrorSchema.parse(await response.json())

    expect(captureOutput({ status: response.status, error })).toEqual({
      status: 400,
      error: { error: 'from must be on or before to' },
    })
  })
})
