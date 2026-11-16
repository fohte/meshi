import type { Context, Hono } from 'hono'
import { z } from 'zod'

import { jsonBadRequest, jsonServerError, parseJsonBody } from '#api/errors'
import { jstDateRangeQuerySchema } from '#api/jst-date-range'
import type { BodyCompositionService } from '#domain/body-composition/body-composition-service'
import type { BodyCompositionDomainError } from '#domain/body-composition/errors'
import type { BodyComposition } from '#domain/body-composition/types'
import { jstDateSchema } from '#lib/jst-date'

const bodyCompositionErrorResponse = (
  c: Context,
  error: BodyCompositionDomainError,
): Response => {
  if (error.code === 'body_composition/not_found') {
    return c.json({ error: error.message }, 404)
  }
  if (error.code === 'body_composition/duplicate') {
    return c.json({ error: error.message }, 409)
  }
  if (
    error.code === 'body_composition/invalid_date' ||
    error.code === 'body_composition/future_date' ||
    error.code === 'body_composition/measured_at_date_mismatch' ||
    error.code === 'body_composition/invalid_device' ||
    error.code === 'body_composition/no_values' ||
    error.code === 'body_composition/invalid_value'
  ) {
    return jsonBadRequest(c, error.message)
  }
  return jsonServerError(c, error)
}

const dateRangeSchema = jstDateRangeQuerySchema.refine(
  ({ from, to }) => from <= to,
  { message: 'from must be on or before to' },
)

const measuredAtSchema = z.iso.datetime({ offset: true })
const nullableValueSchema = z.number().nullable().optional()

const recordBodySchema = z.object({
  date: jstDateSchema,
  measuredAt: measuredAtSchema.nullable().optional(),
  device: z.string(),
  bodyFatPercent: nullableValueSchema,
  muscleMassKg: nullableValueSchema,
  skeletalMusclePercent: nullableValueSchema,
})

const updateBodySchema = z
  .object({
    date: jstDateSchema.optional(),
    measuredAt: measuredAtSchema.nullable().optional(),
    device: z.string().optional(),
    bodyFatPercent: nullableValueSchema,
    muscleMassKg: nullableValueSchema,
    skeletalMusclePercent: nullableValueSchema,
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one field must be provided',
  })

const toBodyCompositionJson = (row: BodyComposition) => ({
  id: row.id,
  date: row.date,
  measuredAt: row.measuredAt?.toISOString() ?? null,
  device: row.device,
  bodyFatPercent: row.bodyFatPercent,
  muscleMassKg: row.muscleMassKg,
  skeletalMusclePercent: row.skeletalMusclePercent,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

export const mountBodyCompositionRoutes = (
  app: Hono,
  service: BodyCompositionService,
): void => {
  app.get('/api/body-compositions', async (c) => {
    const parsed = dateRangeSchema.safeParse(c.req.query())
    if (!parsed.success) {
      return jsonBadRequest(
        c,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      )
    }
    const result = await service.list(parsed.data.from, parsed.data.to)
    return result.match(
      (rows) => c.json(rows.map(toBodyCompositionJson)),
      (error) => bodyCompositionErrorResponse(c, error),
    )
  })

  app.post('/api/body-compositions', async (c) => {
    const parsed = await parseJsonBody(c, recordBodySchema)
    if (parsed.isErr()) return parsed.error
    const result = await service.record({
      date: parsed.value.date,
      device: parsed.value.device,
      ...(parsed.value.measuredAt === undefined
        ? {}
        : {
            measuredAt:
              parsed.value.measuredAt === null
                ? null
                : new Date(parsed.value.measuredAt),
          }),
      ...(parsed.value.bodyFatPercent === undefined
        ? {}
        : { bodyFatPercent: parsed.value.bodyFatPercent }),
      ...(parsed.value.muscleMassKg === undefined
        ? {}
        : { muscleMassKg: parsed.value.muscleMassKg }),
      ...(parsed.value.skeletalMusclePercent === undefined
        ? {}
        : { skeletalMusclePercent: parsed.value.skeletalMusclePercent }),
    })
    return result.match(
      (row) => c.json(toBodyCompositionJson(row), 201),
      (error) => bodyCompositionErrorResponse(c, error),
    )
  })

  app.patch('/api/body-compositions/:id', async (c) => {
    const parsed = await parseJsonBody(c, updateBodySchema)
    if (parsed.isErr()) return parsed.error
    const result = await service.update({
      id: c.req.param('id'),
      ...(parsed.value.date === undefined ? {} : { date: parsed.value.date }),
      ...(parsed.value.device === undefined
        ? {}
        : { device: parsed.value.device }),
      ...(parsed.value.measuredAt === undefined
        ? {}
        : {
            measuredAt:
              parsed.value.measuredAt === null
                ? null
                : new Date(parsed.value.measuredAt),
          }),
      ...(parsed.value.bodyFatPercent === undefined
        ? {}
        : { bodyFatPercent: parsed.value.bodyFatPercent }),
      ...(parsed.value.muscleMassKg === undefined
        ? {}
        : { muscleMassKg: parsed.value.muscleMassKg }),
      ...(parsed.value.skeletalMusclePercent === undefined
        ? {}
        : { skeletalMusclePercent: parsed.value.skeletalMusclePercent }),
    })
    return result.match(
      (row) => c.json(toBodyCompositionJson(row)),
      (error) => bodyCompositionErrorResponse(c, error),
    )
  })

  app.delete('/api/body-compositions/:id', async (c) => {
    const result = await service.delete(c.req.param('id'))
    return result.match(
      () => c.body(null, 204),
      (error) => bodyCompositionErrorResponse(c, error),
    )
  })
}
