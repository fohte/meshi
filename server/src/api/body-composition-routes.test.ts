import { Hono } from 'hono'
import { expect, it } from 'vitest'
import { z } from 'zod'

import { mountBodyCompositionRoutes } from '#api/body-composition-routes'
import { createBodyCompositionService } from '#domain/body-composition/body-composition-service'
import { createDrizzleBodyCompositionRepository } from '#domain/body-composition/drizzle-body-composition-repository'
import { jstDateSchema } from '#lib/jst-date'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import { seedBodyComposition } from '#test/seed'

const NOW = new Date('2026-11-16T12:00:00.000Z')
const responseRowSchema = z.strictObject({
  id: z.string(),
  date: jstDateSchema,
  measuredAt: z.iso.datetime({ offset: true }).nullable(),
  device: z.string(),
  bodyFatPercent: z.number().nullable(),
  muscleMassKg: z.number().nullable(),
  skeletalMusclePercent: z.number().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})
const responseErrorSchema = z.strictObject({ error: z.string() })
const captureOutput = <Output>(output: Output): Output => output

const createTestApp = (sql: ReturnType<ReturnType<typeof setupDrizzleTx>>) => {
  const service = createBodyCompositionService({
    repository: createDrizzleBodyCompositionRepository(sql),
    idGenerator: (() => {
      let nextId = 0
      return () => `body_composition_${String(++nextId)}`
    })(),
    now: () => NOW,
  })
  const app = new Hono()
  mountBodyCompositionRoutes(app, service)
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

describeIfDb('body composition API routes', () => {
  const getTx = setupDrizzleTx()

  it('records single and multiple values, returns nulls, and handles resends', async () => {
    const tx = getTx()
    const app = createTestApp(tx)
    const firstResponse = await requestJson(
      app,
      '/api/body-compositions',
      'POST',
      {
        date: '2026-11-16',
        device: '  Sample Scale  ',
        bodyFatPercent: 24.5,
      },
    )
    const first = responseRowSchema.parse(await firstResponse.json())
    const resendResponse = await requestJson(
      app,
      '/api/body-compositions',
      'POST',
      {
        date: '2026-11-16',
        device: 'Sample Scale',
        bodyFatPercent: 24.5,
      },
    )
    const resend = responseRowSchema.parse(await resendResponse.json())
    const multipleResponse = await requestJson(
      app,
      '/api/body-compositions',
      'POST',
      {
        date: '2026-11-16',
        measuredAt: '2026-11-16T08:00:00+09:00',
        device: 'Sample Scale',
        muscleMassKg: 48.25,
        skeletalMusclePercent: 33.5,
      },
    )
    const multiple = responseRowSchema.parse(await multipleResponse.json())
    const persistedIds = await tx<{ id: string }[]>`
      SELECT id FROM body_compositions ORDER BY id
    `

    expect(
      captureOutput({
        responses: [
          firstResponse.status,
          normalizeRow(first),
          resendResponse.status,
          normalizeRow(resend),
          multipleResponse.status,
          normalizeRow(multiple),
        ],
        persistedIds: persistedIds.map(({ id }) => id),
      }),
    ).toEqual({
      responses: [
        201,
        {
          id: 'body_composition_1',
          date: '2026-11-16',
          measuredAt: null,
          device: 'Sample Scale',
          bodyFatPercent: 24.5,
          muscleMassKg: null,
          skeletalMusclePercent: null,
          createdAt: '<timestamp>',
          updatedAt: '<timestamp>',
        },
        201,
        {
          id: 'body_composition_1',
          date: '2026-11-16',
          measuredAt: null,
          device: 'Sample Scale',
          bodyFatPercent: 24.5,
          muscleMassKg: null,
          skeletalMusclePercent: null,
          createdAt: '<timestamp>',
          updatedAt: '<timestamp>',
        },
        201,
        {
          id: 'body_composition_3',
          date: '2026-11-16',
          measuredAt: '2026-11-15T23:00:00.000Z',
          device: 'Sample Scale',
          bodyFatPercent: null,
          muscleMassKg: 48.25,
          skeletalMusclePercent: 33.5,
          createdAt: '<timestamp>',
          updatedAt: '<timestamp>',
        },
      ],
      persistedIds: ['body_composition_1', 'body_composition_3'],
    })
  })

  it('lists the inclusive date range in date and measurement time order', async () => {
    const tx = getTx()
    await seedBodyComposition(tx, {
      id: 'composition_morning',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: new Date('2026-11-16T00:00:00.000Z'),
      device: 'Sample Scale',
      bodyFatPercent: 24,
    })
    await seedBodyComposition(tx, {
      id: 'composition_evening',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: new Date('2026-11-16T03:00:00.000Z'),
      device: 'Sample Scale',
      muscleMassKg: 48,
    })
    await seedBodyComposition(tx, {
      id: 'composition_unknown_time',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: null,
      device: 'Sample Scale',
      skeletalMusclePercent: 33,
    })
    await seedBodyComposition(tx, {
      id: 'composition_from_boundary',
      measuredDate: jstDate('2025-01-02'),
      measuredAt: null,
      device: 'Sample Scale',
      bodyFatPercent: 25,
    })
    await seedBodyComposition(tx, {
      id: 'composition_outside_range',
      measuredDate: jstDate('2024-12-31'),
      measuredAt: null,
      device: 'Sample Scale',
      bodyFatPercent: 26,
    })
    const app = createTestApp(tx)
    const response = await app.request(
      '/api/body-compositions?from=2025-01-02&to=2026-11-16',
    )
    const rows = z.array(responseRowSchema).parse(await response.json())

    expect(
      captureOutput({ status: response.status, rows: rows.map(normalizeRow) }),
    ).toEqual({
      status: 200,
      rows: [
        {
          id: 'composition_evening',
          date: '2026-11-16',
          measuredAt: '2026-11-16T03:00:00.000Z',
          device: 'Sample Scale',
          bodyFatPercent: null,
          muscleMassKg: 48,
          skeletalMusclePercent: null,
          createdAt: '<timestamp>',
          updatedAt: '<timestamp>',
        },
        {
          id: 'composition_morning',
          date: '2026-11-16',
          measuredAt: '2026-11-16T00:00:00.000Z',
          device: 'Sample Scale',
          bodyFatPercent: 24,
          muscleMassKg: null,
          skeletalMusclePercent: null,
          createdAt: '<timestamp>',
          updatedAt: '<timestamp>',
        },
        {
          id: 'composition_unknown_time',
          date: '2026-11-16',
          measuredAt: null,
          device: 'Sample Scale',
          bodyFatPercent: null,
          muscleMassKg: null,
          skeletalMusclePercent: 33,
          createdAt: '<timestamp>',
          updatedAt: '<timestamp>',
        },
        {
          id: 'composition_from_boundary',
          date: '2025-01-02',
          measuredAt: null,
          device: 'Sample Scale',
          bodyFatPercent: 25,
          muscleMassKg: null,
          skeletalMusclePercent: null,
          createdAt: '<timestamp>',
          updatedAt: '<timestamp>',
        },
      ],
    })
  })

  it('updates provided fields, preserves omitted fields, and trims the device', async () => {
    const tx = getTx()
    await seedBodyComposition(tx, {
      id: 'composition_target',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: new Date('2026-11-16T06:00:00.000Z'),
      device: 'Sample Scale',
      bodyFatPercent: 24,
      muscleMassKg: 48,
    })
    const app = createTestApp(tx)
    const updatedResponse = await requestJson(
      app,
      '/api/body-compositions/composition_target',
      'PATCH',
      {
        bodyFatPercent: null,
        skeletalMusclePercent: 32.5,
        device: '  Sample Scale  ',
      },
    )
    const updated = responseRowSchema.parse(await updatedResponse.json())

    expect(
      captureOutput([updatedResponse.status, normalizeRow(updated)]),
    ).toEqual([
      200,
      {
        id: 'composition_target',
        date: '2026-11-16',
        measuredAt: '2026-11-16T06:00:00.000Z',
        device: 'Sample Scale',
        bodyFatPercent: null,
        muscleMassKg: 48,
        skeletalMusclePercent: 32.5,
        createdAt: '<timestamp>',
        updatedAt: '<timestamp>',
      },
    ])
  })

  it('rejects a correction that clears every measurement value', async () => {
    const tx = getTx()
    await seedBodyComposition(tx, {
      id: 'composition_clear',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: null,
      device: 'Sample Scale',
      bodyFatPercent: 24,
    })
    const app = createTestApp(tx)
    const response = await requestJson(
      app,
      '/api/body-compositions/composition_clear',
      'PATCH',
      { bodyFatPercent: null },
    )
    const error = responseErrorSchema.parse(await response.json())

    expect(captureOutput([response.status, error])).toEqual([
      400,
      { error: 'at least one body composition value is required' },
    ])
  })

  it('returns a conflict when a correction duplicates another record', async () => {
    const tx = getTx()
    await seedBodyComposition(tx, {
      id: 'composition_duplicate_target',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: null,
      device: 'Sample Scale',
      bodyFatPercent: 26,
      muscleMassKg: 51,
    })
    await seedBodyComposition(tx, {
      id: 'composition_duplicate_source',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: null,
      device: 'Sample Scale',
      bodyFatPercent: 25,
      muscleMassKg: 50,
    })
    const app = createTestApp(tx)
    const response = await requestJson(
      app,
      '/api/body-compositions/composition_duplicate_source',
      'PATCH',
      { bodyFatPercent: 26, muscleMassKg: 51 },
    )
    const error = responseErrorSchema.parse(await response.json())

    expect(captureOutput([response.status, error])).toEqual([
      409,
      { error: 'body composition conflicts with another measurement' },
    ])
  })

  it('deletes an existing record', async () => {
    const tx = getTx()
    await seedBodyComposition(tx, {
      id: 'composition_delete',
      measuredDate: jstDate('2026-11-16'),
      measuredAt: null,
      device: 'Sample Scale',
      bodyFatPercent: 24,
    })
    const app = createTestApp(tx)
    const deleted = await requestJson(
      app,
      '/api/body-compositions/composition_delete',
      'DELETE',
    )
    expect(captureOutput(deleted.status)).toEqual(204)
  })

  it('returns not found when deleting a missing record', async () => {
    const app = createTestApp(getTx())
    const response = await requestJson(
      app,
      '/api/body-compositions/missing',
      'DELETE',
    )
    const error = responseErrorSchema.parse(await response.json())

    expect(captureOutput([response.status, error])).toEqual([
      404,
      { error: 'body composition not found: missing' },
    ])
  })

  it('rejects invalid dates, devices, absent values, future measurements, and invalid values', async () => {
    const app = createTestApp(getTx())
    const requests = await Promise.all([
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-02-30',
        device: 'Sample Scale',
        bodyFatPercent: 24,
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-17',
        device: 'Sample Scale',
        bodyFatPercent: 24,
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-16',
        device: 'Sample Scale',
        bodyFatPercent: 24,
        measuredAt: '2026-11-16T12:00:00.001Z',
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-16',
        device: 'Sample Scale',
        bodyFatPercent: 24,
        measuredAt: '2026-11-16T00:00:00+14:00',
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-16',
        device: '   ',
        bodyFatPercent: 24,
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-16',
        device: 'x'.repeat(101),
        bodyFatPercent: 24,
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-16',
        device: 'Sample Scale',
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-16',
        device: 'Sample Scale',
        bodyFatPercent: 0.99,
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-16',
        device: 'Sample Scale',
        bodyFatPercent: 75.01,
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-16',
        device: 'Sample Scale',
        bodyFatPercent: 24.001,
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-16',
        device: 'Sample Scale',
        muscleMassKg: 4.99,
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-16',
        device: 'Sample Scale',
        muscleMassKg: 200.01,
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-16',
        device: 'Sample Scale',
        muscleMassKg: 48.001,
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-16',
        device: 'Sample Scale',
        skeletalMusclePercent: 0.99,
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-16',
        device: 'Sample Scale',
        skeletalMusclePercent: 75.01,
      }),
      requestJson(app, '/api/body-compositions', 'POST', {
        date: '2026-11-16',
        device: 'Sample Scale',
        skeletalMusclePercent: 33.001,
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
      [400, { error: 'body composition date is in the future: 2026-11-17' }],
      [400, { error: 'measuredAt must not be in the future' }],
      [
        400,
        { error: 'measuredAt must fall on the body composition date in JST' },
      ],
      [400, { error: 'device must contain 1 to 100 characters' }],
      [400, { error: 'device must contain 1 to 100 characters' }],
      [400, { error: 'at least one body composition value is required' }],
      [
        400,
        {
          error:
            'bodyFatPercent is outside its supported range or has more than 2 decimal places: 0.99',
        },
      ],
      [
        400,
        {
          error:
            'bodyFatPercent is outside its supported range or has more than 2 decimal places: 75.01',
        },
      ],
      [
        400,
        {
          error:
            'bodyFatPercent is outside its supported range or has more than 2 decimal places: 24.001',
        },
      ],
      [
        400,
        {
          error:
            'muscleMassKg is outside its supported range or has more than 2 decimal places: 4.99',
        },
      ],
      [
        400,
        {
          error:
            'muscleMassKg is outside its supported range or has more than 2 decimal places: 200.01',
        },
      ],
      [
        400,
        {
          error:
            'muscleMassKg is outside its supported range or has more than 2 decimal places: 48.001',
        },
      ],
      [
        400,
        {
          error:
            'skeletalMusclePercent is outside its supported range or has more than 2 decimal places: 0.99',
        },
      ],
      [
        400,
        {
          error:
            'skeletalMusclePercent is outside its supported range or has more than 2 decimal places: 75.01',
        },
      ],
      [
        400,
        {
          error:
            'skeletalMusclePercent is outside its supported range or has more than 2 decimal places: 33.001',
        },
      ],
    ])
  })
})
