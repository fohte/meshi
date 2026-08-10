import type { Hono } from 'hono'

import { jsonBadRequest, jsonServerError } from '#api/errors'
import { jstCalendarDateSchema } from '#api/jst-date-range'
import type { DayDetailService } from '#domain/day-detail/types'

export const mountDayDetailRoutes = (
  app: Hono,
  dayDetailService: DayDetailService,
): void => {
  app.get('/api/days/:date', async (c) => {
    const dateParam = c.req.param('date')
    const parsed = jstCalendarDateSchema.safeParse(dateParam)
    if (!parsed.success) {
      return jsonBadRequest(
        c,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      )
    }

    const result = await dayDetailService.query({ date: parsed.data })

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
            eatenDate: entry.eatenDate,
            mealType: entry.mealType,
            quantity: entry.quantity,
            kcal: entry.kcal,
            isEstimated: entry.isEstimated,
          })),
        }),
      (queryError) => jsonServerError(c, queryError),
    )
  })
}
