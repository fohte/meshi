import type { ResultAsync } from 'neverthrow'

import type { BodyWeightRepository } from '#domain/body-weight/body-weight-repository'
import type { BodyWeightService } from '#domain/body-weight/body-weight-service'
import type { BodyWeightDomainError } from '#domain/body-weight/errors'
import type { UserProfileRepositoryError } from '#domain/user-profile/errors'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'
import {
  calculateWeightOutlook,
  getWeightOutlookStartDate,
  type WeightOutlook,
} from '#domain/weight-outlook/weight-outlook-calculator'
import { toJstDateString } from '#lib/jst-date'

export interface WeightOutlookService {
  get(): ResultAsync<WeightOutlook, WeightOutlookServiceError>
}

type WeightOutlookServiceError =
  BodyWeightDomainError | UserProfileRepositoryError

export interface WeightOutlookServiceDeps {
  readonly bodyWeightService: BodyWeightService
  readonly bodyWeightHistoryRepository: Pick<
    BodyWeightRepository,
    'firstMeasurementDate'
  >
  readonly userProfileService: UserProfileService
  readonly now?: () => Date
}

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
          deps.bodyWeightHistoryRepository
            .firstMeasurementDate()
            .andThen((firstDate) =>
              deps.bodyWeightService
                .list(getWeightOutlookStartDate(asOf), asOf)
                .map((weights) =>
                  calculateWeightOutlook(
                    weights,
                    firstDate,
                    asOf,
                    profile.goalWeightKg ?? null,
                  ),
                ),
            ),
        )
    },
  }
}
