import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import type { BodyWeightRepository } from '#domain/body-weight/body-weight-repository'
import {
  type BodyWeightDomainError,
  BodyWeightMeasuredAtDateMismatchError,
  BodyWeightNotFoundError,
  FutureBodyWeightDateError,
  InvalidBodyWeightDateError,
  InvalidBodyWeightValueError,
} from '#domain/body-weight/errors'
import type {
  BodyWeight,
  RecordBodyWeightInput,
  UpdateBodyWeightInput,
} from '#domain/body-weight/types'
import {
  isValidJstCalendarDateString,
  type JstDate,
  toJstDateString,
} from '#lib/jst-date'

export interface BodyWeightService {
  record(
    input: RecordBodyWeightInput,
  ): ResultAsync<BodyWeight, BodyWeightDomainError>
  list(
    from: JstDate,
    to: JstDate,
  ): ResultAsync<ReadonlyArray<BodyWeight>, BodyWeightDomainError>
  update(
    input: UpdateBodyWeightInput,
  ): ResultAsync<BodyWeight, BodyWeightDomainError>
  delete(id: string): ResultAsync<void, BodyWeightDomainError>
}

export interface BodyWeightServiceDeps {
  readonly repository: BodyWeightRepository
  readonly idGenerator: () => string
  readonly now: () => Date
}

const hasAtMostTwoDecimalPlaces = (weightKg: number): boolean => {
  const value = String(weightKg).toLowerCase()
  const [coefficient = value] = value.split('e')
  const decimalPlaces = coefficient.split('.')[1]?.length ?? 0
  return decimalPlaces <= 2
}

const validate = (
  date: string,
  measuredAt: Date | null,
  weightKg: number,
  now: Date,
): BodyWeightDomainError | undefined => {
  if (!isValidJstCalendarDateString(date)) {
    return new InvalidBodyWeightDateError(date)
  }
  if (date > toJstDateString(now)) {
    return new FutureBodyWeightDateError(date)
  }
  if (
    !Number.isFinite(weightKg) ||
    weightKg < 20 ||
    weightKg > 300 ||
    !hasAtMostTwoDecimalPlaces(weightKg)
  ) {
    return new InvalidBodyWeightValueError(weightKg)
  }
  if (measuredAt !== null) {
    if (!Number.isFinite(measuredAt.getTime())) {
      return new FutureBodyWeightDateError('invalid measuredAt')
    }
    if (measuredAt > now) {
      return new FutureBodyWeightDateError(measuredAt.toISOString())
    }
    if (toJstDateString(measuredAt) !== date) {
      return new BodyWeightMeasuredAtDateMismatchError(date, measuredAt)
    }
  }
  return undefined
}

export const createBodyWeightService = (
  deps: BodyWeightServiceDeps,
): BodyWeightService => ({
  record(input) {
    const measuredAt = input.measuredAt ?? null
    const error = validate(input.date, measuredAt, input.weightKg, deps.now())
    if (error !== undefined) return errAsync(error)
    return deps.repository.create({
      id: deps.idGenerator(),
      date: input.date,
      measuredAt,
      weightKg: input.weightKg,
    })
  },
  list(from, to) {
    if (!isValidJstCalendarDateString(from)) {
      return errAsync(new InvalidBodyWeightDateError(from))
    }
    if (!isValidJstCalendarDateString(to)) {
      return errAsync(new InvalidBodyWeightDateError(to))
    }
    return deps.repository.list(from, to)
  },
  update(input) {
    return deps.repository.findById(input.id).andThen((existing) => {
      if (existing === null)
        return errAsync(new BodyWeightNotFoundError(input.id))
      const date = input.date ?? existing.date
      const measuredAt =
        input.measuredAt === undefined ? existing.measuredAt : input.measuredAt
      const weightKg = input.weightKg ?? existing.weightKg
      const error = validate(date, measuredAt, weightKg, deps.now())
      if (error !== undefined) return errAsync(error)
      return deps.repository
        .update(input.id, { date, measuredAt, weightKg })
        .andThen((row) =>
          row === null
            ? errAsync(new BodyWeightNotFoundError(input.id))
            : okAsync(row),
        )
    })
  },
  delete(id) {
    return deps.repository
      .delete(id)
      .andThen((deleted) =>
        deleted
          ? okAsync(undefined)
          : errAsync(new BodyWeightNotFoundError(id)),
      )
  },
})
