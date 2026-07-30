import type { Hono } from 'hono'

import { jsonBadRequest, jsonServerError } from '#api/errors'
import { jstDayBoundaryQuerySchema } from '#api/jst-date-range'
import type { DayDetailService } from '#domain/day-detail/types'

export const mountDayDetailRoutes = (
  app: Hono,
  dayDetailService: DayDetailService,
): void => {
  app.get('/api/days/:date', async (c) => {
    const dateParam = c.req.param('date')
    const parsed = jstDayBoundaryQuerySchema.safeParse({ date: dateParam })
    if (!parsed.success) {
      return jsonBadRequest(
        c,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      )
    }

    const result = await dayDetailService.query({
      periodFrom: parsed.data.from,
      periodTo: parsed.data.to,
      date: dateParam,
    })

    return result.match(
      (detail) =>
        c.json({
          date: dateParam,
          totals: detail.totals,
          hasEstimatedValues: detail.hasEstimatedValues,
          skippedMealTypes: detail.skippedMealTypes,
          entries: detail.entries.map((entry) => ({
            id: entry.id,
            foodMasterId: entry.foodMasterId,
            foodName: entry.foodName,
            eatenAt: entry.eatenAt.toISOString(),
            mealType: entry.mealType,
            quantity: entry.quantity,
            unit: entry.unit,
            note: entry.note,
            kcal: entry.kcal,
            isEstimated: entry.isEstimated,
          })),
        }),
      (queryError) => jsonServerError(c, queryError),
    )
  })
}
