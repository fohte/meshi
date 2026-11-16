import type { ResultAsync } from 'neverthrow'

import type { BodyWeightDomainError } from '#domain/body-weight/errors'
import type { BodyWeight } from '#domain/body-weight/types'
import type { JstDate } from '#lib/jst-date'

interface BodyWeightWrite {
  readonly id: string
  readonly date: JstDate
  readonly measuredAt: Date | null
  readonly weightKg: number
}

type BodyWeightUpdate = Omit<BodyWeightWrite, 'id'>

export interface BodyWeightRepository {
  create(input: BodyWeightWrite): ResultAsync<BodyWeight, BodyWeightDomainError>
  list(
    from: JstDate,
    to: JstDate,
  ): ResultAsync<ReadonlyArray<BodyWeight>, BodyWeightDomainError>
  findById(id: string): ResultAsync<BodyWeight | null, BodyWeightDomainError>
  update(
    id: string,
    input: BodyWeightUpdate,
  ): ResultAsync<BodyWeight | null, BodyWeightDomainError>
  delete(id: string): ResultAsync<boolean, BodyWeightDomainError>
}
