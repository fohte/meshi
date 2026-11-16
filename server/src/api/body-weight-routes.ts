import type { Context, Hono } from 'hono'
import { z } from 'zod'

import { jsonBadRequest, jsonServerError, parseJsonBody } from '#api/errors'
import { jstDateRangeQuerySchema } from '#api/jst-date-range'
import type { BodyWeightService } from '#domain/body-weight/body-weight-service'
import type { BodyWeightDomainError } from '#domain/body-weight/errors'
import type { BodyWeight } from '#domain/body-weight/types'
import { jstDateSchema } from '#lib/jst-date'

const bodyWeightErrorResponse = (
  c: Context,
  error: BodyWeightDomainError,
): Response => {
  if (error.code === 'body_weight/not_found') {
    return c.json({ error: error.message }, 404)
  }
  if (error.code === 'body_weight/duplicate') {
    return c.json({ error: error.message }, 409)
  }
  if (
    error.code === 'body_weight/invalid_date' ||
    error.code === 'body_weight/future_date' ||
    error.code === 'body_weight/measured_at_date_mismatch' ||
    error.code === 'body_weight/invalid_weight'
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

const recordBodySchema = z.object({
  date: jstDateSchema,
  weightKg: z.number(),
  measuredAt: measuredAtSchema.optional(),
})

const updateBodySchema = z
  .object({
    date: jstDateSchema.optional(),
    weightKg: z.number().optional(),
    measuredAt: measuredAtSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one field must be provided',
  })

const toBodyWeightJson = (row: BodyWeight) => ({
  id: row.id,
  date: row.date,
  measuredAt: row.measuredAt?.toISOString() ?? null,
  weightKg: row.weightKg,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

export const mountBodyWeightRoutes = (
  app: Hono,
  service: BodyWeightService,
): void => {
  app.get('/api/body-weights', async (c) => {
    const parsed = dateRangeSchema.safeParse(c.req.query())
    if (!parsed.success) {
      return jsonBadRequest(
        c,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      )
    }
    const result = await service.list(parsed.data.from, parsed.data.to)
    return result.match(
      (rows) => c.json(rows.map(toBodyWeightJson)),
      (error) => bodyWeightErrorResponse(c, error),
    )
  })

  app.post('/api/body-weights', async (c) => {
    const parsed = await parseJsonBody(c, recordBodySchema)
    if (parsed.isErr()) return parsed.error
    const result = await service.record({
      date: parsed.value.date,
      weightKg: parsed.value.weightKg,
      ...(parsed.value.measuredAt === undefined
        ? {}
        : { measuredAt: new Date(parsed.value.measuredAt) }),
    })
    return result.match(
      (row) => c.json(toBodyWeightJson(row), 201),
      (error) => bodyWeightErrorResponse(c, error),
    )
  })

  app.patch('/api/body-weights/:id', async (c) => {
    const parsed = await parseJsonBody(c, updateBodySchema)
    if (parsed.isErr()) return parsed.error
    const result = await service.update({
      id: c.req.param('id'),
      ...(parsed.value.date === undefined ? {} : { date: parsed.value.date }),
      ...(parsed.value.weightKg === undefined
        ? {}
        : { weightKg: parsed.value.weightKg }),
      ...(parsed.value.measuredAt === undefined
        ? {}
        : {
            measuredAt:
              parsed.value.measuredAt === null
                ? null
                : new Date(parsed.value.measuredAt),
          }),
    })
    return result.match(
      (row) => c.json(toBodyWeightJson(row)),
      (error) => bodyWeightErrorResponse(c, error),
    )
  })

  app.delete('/api/body-weights/:id', async (c) => {
    const result = await service.delete(c.req.param('id'))
    return result.match(
      () => c.body(null, 204),
      (error) => bodyWeightErrorResponse(c, error),
    )
  })
}
