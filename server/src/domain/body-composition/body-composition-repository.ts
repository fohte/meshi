import type { Result, ResultAsync } from 'neverthrow'

import type { BodyCompositionDomainError } from '#domain/body-composition/errors'
import type { BodyComposition } from '#domain/body-composition/types'
import type { JstDate } from '#lib/jst-date'

interface BodyCompositionWrite {
  readonly id: string
  readonly date: JstDate
  readonly measuredAt: Date | null
  readonly device: string
  readonly bodyFatPercent: number | null
  readonly muscleMassKg: number | null
  readonly skeletalMusclePercent: number | null
}

type BodyCompositionUpdate = Omit<BodyCompositionWrite, 'id'>

export interface BodyCompositionRepository {
  create(
    input: BodyCompositionWrite,
  ): ResultAsync<BodyComposition, BodyCompositionDomainError>
  list(
    from: JstDate,
    to: JstDate,
  ): ResultAsync<ReadonlyArray<BodyComposition>, BodyCompositionDomainError>
  update(
    id: string,
    resolveUpdate: (
      existing: BodyComposition,
    ) => Result<BodyCompositionUpdate, BodyCompositionDomainError>,
  ): ResultAsync<BodyComposition | null, BodyCompositionDomainError>
  delete(id: string): ResultAsync<boolean, BodyCompositionDomainError>
}
