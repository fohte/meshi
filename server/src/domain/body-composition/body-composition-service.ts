import { err, errAsync, ok, okAsync, type ResultAsync } from 'neverthrow'

import type { BodyCompositionRepository } from '#domain/body-composition/body-composition-repository'
import {
  type BodyCompositionDomainError,
  BodyCompositionMeasuredAtDateMismatchError,
  BodyCompositionNotFoundError,
  BodyCompositionNoValuesError,
  FutureBodyCompositionDateError,
  FutureBodyCompositionMeasurementError,
  InvalidBodyCompositionDateError,
  InvalidBodyCompositionDeviceError,
  InvalidBodyCompositionValueError,
} from '#domain/body-composition/errors'
import type {
  BodyComposition,
  RecordBodyCompositionInput,
  UpdateBodyCompositionInput,
} from '#domain/body-composition/types'
import {
  isValidJstCalendarDateString,
  type JstDate,
  toJstDateString,
} from '#lib/jst-date'

export interface BodyCompositionService {
  record(
    input: RecordBodyCompositionInput,
  ): ResultAsync<BodyComposition, BodyCompositionDomainError>
  list(
    from: JstDate,
    to: JstDate,
  ): ResultAsync<ReadonlyArray<BodyComposition>, BodyCompositionDomainError>
  update(
    input: UpdateBodyCompositionInput,
  ): ResultAsync<BodyComposition, BodyCompositionDomainError>
  delete(id: string): ResultAsync<void, BodyCompositionDomainError>
}

export interface BodyCompositionServiceDeps {
  readonly repository: BodyCompositionRepository
  readonly idGenerator: () => string
  readonly now: () => Date
}

const hasAtMostTwoDecimalPlaces = (value: number): boolean => {
  const [coefficient = String(value), exponentText] = String(value)
    .toLowerCase()
    .split('e')
  const decimalPlaces = coefficient.split('.')[1]?.length ?? 0
  const exponent = exponentText === undefined ? 0 : Number(exponentText)
  return decimalPlaces - exponent <= 2
}

interface CompositionValues {
  readonly bodyFatPercent: number | null
  readonly muscleMassKg: number | null
  readonly skeletalMusclePercent: number | null
}

const validate = (
  date: string,
  measuredAt: Date | null,
  device: string,
  values: CompositionValues,
  now: Date,
): BodyCompositionDomainError | undefined => {
  if (!isValidJstCalendarDateString(date)) {
    return new InvalidBodyCompositionDateError(date)
  }
  if (date > toJstDateString(now)) {
    return new FutureBodyCompositionDateError(date)
  }
  if (measuredAt !== null) {
    if (!Number.isFinite(measuredAt.getTime())) {
      return new InvalidBodyCompositionDateError('measuredAt')
    }
    if (measuredAt > now) {
      return new FutureBodyCompositionMeasurementError(measuredAt)
    }
    if (toJstDateString(measuredAt) !== date) {
      return new BodyCompositionMeasuredAtDateMismatchError(date, measuredAt)
    }
  }
  const normalizedDevice = device.trim()
  if (normalizedDevice.length < 1 || normalizedDevice.length > 100) {
    return new InvalidBodyCompositionDeviceError(device)
  }
  if (
    values.bodyFatPercent === null &&
    values.muscleMassKg === null &&
    values.skeletalMusclePercent === null
  ) {
    return new BodyCompositionNoValuesError()
  }
  const checks = [
    ['bodyFatPercent', values.bodyFatPercent, 1, 75],
    ['muscleMassKg', values.muscleMassKg, 5, 200],
    ['skeletalMusclePercent', values.skeletalMusclePercent, 1, 75],
  ] as const
  for (const [field, value, min, max] of checks) {
    if (
      value !== null &&
      (!Number.isFinite(value) ||
        value < min ||
        value > max ||
        !hasAtMostTwoDecimalPlaces(value))
    ) {
      return new InvalidBodyCompositionValueError(field, value)
    }
  }
  return undefined
}

const normalizeDevice = (device: string): string => device.trim()

export const createBodyCompositionService = (
  deps: BodyCompositionServiceDeps,
): BodyCompositionService => ({
  record(input) {
    const measuredAt = input.measuredAt ?? null
    const values = {
      bodyFatPercent: input.bodyFatPercent ?? null,
      muscleMassKg: input.muscleMassKg ?? null,
      skeletalMusclePercent: input.skeletalMusclePercent ?? null,
    }
    const error = validate(
      input.date,
      measuredAt,
      input.device,
      values,
      deps.now(),
    )
    if (error !== undefined) return errAsync(error)
    return deps.repository.create({
      id: deps.idGenerator(),
      date: input.date,
      measuredAt,
      device: normalizeDevice(input.device),
      ...values,
    })
  },
  list(from, to) {
    if (!isValidJstCalendarDateString(from)) {
      return errAsync(new InvalidBodyCompositionDateError(from))
    }
    if (!isValidJstCalendarDateString(to)) {
      return errAsync(new InvalidBodyCompositionDateError(to))
    }
    return deps.repository.list(from, to)
  },
  update(input) {
    const now = deps.now()
    return deps.repository
      .update(input.id, (existing) => {
        const date = input.date ?? existing.date
        const measuredAt =
          input.measuredAt === undefined
            ? existing.measuredAt
            : input.measuredAt
        const device =
          input.device === undefined ? existing.device : input.device
        const values = {
          bodyFatPercent:
            input.bodyFatPercent === undefined
              ? existing.bodyFatPercent
              : input.bodyFatPercent,
          muscleMassKg:
            input.muscleMassKg === undefined
              ? existing.muscleMassKg
              : input.muscleMassKg,
          skeletalMusclePercent:
            input.skeletalMusclePercent === undefined
              ? existing.skeletalMusclePercent
              : input.skeletalMusclePercent,
        }
        const error = validate(date, measuredAt, device, values, now)
        if (error !== undefined) return err(error)
        return ok({
          date,
          measuredAt,
          device: normalizeDevice(device),
          ...values,
        })
      })
      .andThen((row) =>
        row === null
          ? errAsync(new BodyCompositionNotFoundError(input.id))
          : okAsync(row),
      )
  },
  delete(id) {
    return deps.repository
      .delete(id)
      .andThen((deleted) =>
        deleted
          ? okAsync(undefined)
          : errAsync(new BodyCompositionNotFoundError(id)),
      )
  },
})
