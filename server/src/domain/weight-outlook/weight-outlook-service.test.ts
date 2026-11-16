import { okAsync } from 'neverthrow'
import { expect, it } from 'vitest'

import { DEFAULT_USER_PROFILE } from '#domain/user-profile/user-profile'
import { createWeightOutlookService } from '#domain/weight-outlook/weight-outlook-service'
import { type JstDate, jstDateSchema } from '#lib/jst-date'
import { createStubApiDeps } from '#test/api-stubs'
import { jstDate } from '#test/jst-date'

it('uses the JST date for the recent window and includes the profile goal', async () => {
  const stubDeps = createStubApiDeps()
  const requestedRanges: Array<readonly [JstDate, JstDate]> = []
  const service = createWeightOutlookService({
    bodyWeightService: {
      ...stubDeps.bodyWeightService,
      list(from, to) {
        requestedRanges.push([from, to])
        return okAsync([])
      },
    },
    bodyWeightHistoryRepository: {
      firstMeasurementDate: () => okAsync(jstDate('2026-10-01')),
    },
    userProfileService: {
      ...stubDeps.userProfileService,
      get: () => okAsync({ ...DEFAULT_USER_PROFILE, goalWeightKg: 65 }),
    },
    now: () => new Date('2026-11-16T15:00:00.000Z'),
  })

  const actual = await service.get().match(
    (outlook) => ({ requestedRanges, outlook }),
    (error) => ({ requestedRanges, error: error.message }),
  )
  expect(actual).toEqual({
    requestedRanges: [[jstDate('2026-10-21'), jstDate('2026-11-17')]],
    outlook: {
      asOf: jstDateSchema.parse('2026-11-17'),
      points: [],
      latestWeightKg: null,
      goalWeightKg: 65,
      trend: null,
      status: 'insufficient_data',
      reason: 'too_few_measurement_days',
      arrivalDateRange: null,
    },
  })
})
