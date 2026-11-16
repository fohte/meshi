import type { ResultAsync } from 'neverthrow'

import type { BodyWeightService } from '#domain/body-weight/body-weight-service'
import type { BodyWeightDomainError } from '#domain/body-weight/errors'
import type { UserProfileRepositoryError } from '#domain/user-profile/errors'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'
import {
  calculateWeightOutlook,
  type WeightOutlook,
} from '#domain/weight-outlook/weight-outlook-calculator'
import { jstDateSchema, toJstDateString } from '#lib/jst-date'

export interface WeightOutlookService {
  get(): ResultAsync<WeightOutlook, WeightOutlookServiceError>
}

type WeightOutlookServiceError =
  BodyWeightDomainError | UserProfileRepositoryError

export interface WeightOutlookServiceDeps {
  readonly bodyWeightService: BodyWeightService
  readonly userProfileService: UserProfileService
  readonly now?: () => Date
}

const FIRST_SUPPORTED_DATE = jstDateSchema.parse('0001-01-01')

export const createWeightOutlookService = (
  deps: WeightOutlookServiceDeps,
): WeightOutlookService => {
  const now = deps.now ?? (() => new Date())
  return {
    get() {
      const asOf = toJstDateString(now())
      return deps.userProfileService
        .get()
        .andThen((profile) =>
          deps.bodyWeightService
            .list(FIRST_SUPPORTED_DATE, asOf)
            .map((weights) =>
              calculateWeightOutlook(
                weights,
                asOf,
                profile.goalWeightKg ?? null,
              ),
            ),
        )
    },
  }
}
