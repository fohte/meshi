import type { Hono } from 'hono'

import { jsonServerError } from '#api/errors'
import type { WeightOutlookService } from '#domain/weight-outlook/weight-outlook-service'

export const mountWeightOutlookRoutes = (
  app: Hono,
  service: WeightOutlookService,
): void => {
  app.get('/api/weight-outlook', async (c) => {
    const result = await service.get()
    return result.match(
      (outlook) => c.json(outlook),
      (error) => jsonServerError(c, error),
    )
  })
}
