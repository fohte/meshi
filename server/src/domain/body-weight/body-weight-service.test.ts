import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import type { BodyWeightRepository } from '#domain/body-weight/body-weight-repository'
import { createBodyWeightService } from '#domain/body-weight/body-weight-service'
import {
  BodyWeightMeasuredAtDateMismatchError,
  BodyWeightNotFoundError,
  FutureBodyWeightDateError,
  FutureBodyWeightMeasurementError,
  InvalidBodyWeightDateError,
  InvalidBodyWeightValueError,
} from '#domain/body-weight/errors'
import type { BodyWeight } from '#domain/body-weight/types'
import type { JstDate } from '#lib/jst-date'
import { jstDate } from '#test/jst-date'

const NOW = new Date('2026-11-16T12:00:00.000Z')
const CREATED_AT = new Date('2026-11-16T12:00:00.000Z')
const captureOutput = <Output>(output: Output): Output => output
// Deliberately malformed so the runtime validator receives an invalid date.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- malformed value for the runtime validation test
const INVALID_DATE = '2026-02-30' as JstDate

const createHarness = () => {
  const rows = new Map<string, BodyWeight>()
  const repository: BodyWeightRepository = {
    create: (input) => {
      const existing = [...rows.values()].find(
        (row) =>
          row.date === input.date &&
          row.measuredAt?.getTime() === input.measuredAt?.getTime() &&
          row.weightKg === input.weightKg,
      )
      if (existing !== undefined) return okAsync(existing)
      const row: BodyWeight = {
        id: input.id,
        date: input.date,
        measuredAt: input.measuredAt,
        weightKg: input.weightKg,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }
      rows.set(row.id, row)
      return okAsync(row)
    },
    firstMeasurementDate: () =>
      okAsync(
        [...rows.values()]
          .map(({ date }) => date)
          .sort((left, right) => left.localeCompare(right))[0] ?? null,
      ),
    list: (from, to) =>
      okAsync(
        [...rows.values()].filter((row) => row.date >= from && row.date <= to),
      ),
    update: (id, resolveUpdate) => {
      const existing = rows.get(id)
      if (existing === undefined) return okAsync(null)
      const changes = resolveUpdate(existing)
      if (changes.isErr()) return errAsync(changes.error)
      const row = { ...existing, ...changes.value, updatedAt: NOW }
      rows.set(id, row)
      return okAsync(row)
    },
    delete: (id) => okAsync(rows.delete(id)),
  }
  let id = 0
  const service = createBodyWeightService({
    repository,
    idGenerator: () => `bw_${String(++id)}`,
    now: () => NOW,
  })
  return { service, rows }
}

describe('BodyWeightService', () => {
  it('keeps multiple records on one day and accepts past dates', async () => {
    const { service, rows } = createHarness()
    const first = await service.record({
      date: jstDate('2026-11-16'),
      weightKg: 70.1,
      measuredAt: new Date('2026-11-16T06:00:00.000Z'),
    })
    const second = await service.record({
      date: jstDate('2026-11-16'),
      weightKg: 69.9,
      measuredAt: new Date('2026-11-16T12:00:00.000Z'),
    })
    const past = await service.record({
      date: jstDate('2025-01-02'),
      weightKg: 71,
    })

    const actual = captureOutput({
      records: [
        first._unsafeUnwrap(),
        second._unsafeUnwrap(),
        past._unsafeUnwrap(),
      ],
      count: rows.size,
    })
    expect(actual).toEqual({
      records: [
        {
          id: 'bw_1',
          date: '2026-11-16',
          measuredAt: new Date('2026-11-16T06:00:00.000Z'),
          weightKg: 70.1,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        },
        {
          id: 'bw_2',
          date: '2026-11-16',
          measuredAt: new Date('2026-11-16T12:00:00.000Z'),
          weightKg: 69.9,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        },
        {
          id: 'bw_3',
          date: '2025-01-02',
          measuredAt: null,
          weightKg: 71,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
        },
      ],
      count: 3,
    })
  })

  it('rejects invalid and future dates', async () => {
    const { service } = createHarness()

    const invalid = await service.record({ date: INVALID_DATE, weightKg: 70 })
    const future = await service.record({
      date: jstDate('2026-11-17'),
      weightKg: 70,
    })

    const actual = captureOutput([
      invalid._unsafeUnwrapErr(),
      future._unsafeUnwrapErr(),
    ])
    expect(actual).toEqual([
      new InvalidBodyWeightDateError(INVALID_DATE),
      new FutureBodyWeightDateError('2026-11-17'),
    ])
  })

  it('rejects weight values outside the range or scale', async () => {
    const { service } = createHarness()
    const results = await Promise.all(
      [19.99, 300.01, 70.001].map((weightKg) =>
        service.record({ date: jstDate('2026-11-16'), weightKg }),
      ),
    )

    const actual = results.map((result) => result._unsafeUnwrapErr())
    expect(actual).toEqual(
      [19.99, 300.01, 70.001].map(
        (weightKg) => new InvalidBodyWeightValueError(weightKg),
      ),
    )
  })

  it('rejects future and date-mismatched measurement instants', async () => {
    const { service } = createHarness()
    const future = await service.record({
      date: jstDate('2026-11-16'),
      measuredAt: new Date('2026-11-16T12:00:00.001Z'),
      weightKg: 70,
    })
    const mismatch = await service.record({
      date: jstDate('2026-11-16'),
      measuredAt: new Date('2026-11-15T14:59:59.999Z'),
      weightKg: 70,
    })

    const actual = captureOutput([
      future._unsafeUnwrapErr(),
      mismatch._unsafeUnwrapErr(),
    ])
    expect(actual).toEqual([
      new FutureBodyWeightMeasurementError(
        new Date('2026-11-16T12:00:00.001Z'),
      ),
      new BodyWeightMeasuredAtDateMismatchError(
        '2026-11-16',
        new Date('2026-11-15T14:59:59.999Z'),
      ),
    ])
  })

  it('returns not found when updating a missing id', async () => {
    const { service } = createHarness()
    const update = await service.update({ id: 'missing', weightKg: 70 })
    expect(captureOutput(update._unsafeUnwrapErr())).toEqual(
      new BodyWeightNotFoundError('missing'),
    )
  })

  it('preserves omitted fields when correcting a record', async () => {
    const { service } = createHarness()
    const created = await service.record({
      date: jstDate('2026-11-16'),
      measuredAt: new Date('2026-11-16T06:00:00.000Z'),
      weightKg: 70,
    })
    const existing = created._unsafeUnwrap()
    const updated = await service.update({ id: existing.id, weightKg: 69.8 })

    expect(captureOutput(updated._unsafeUnwrap())).toEqual({
      id: 'bw_1',
      date: '2026-11-16',
      measuredAt: new Date('2026-11-16T06:00:00.000Z'),
      weightKg: 69.8,
      createdAt: CREATED_AT,
      updatedAt: NOW,
    })
  })

  it('returns not found when deleting a missing id', async () => {
    const { service } = createHarness()
    const result = await service.delete('missing')

    expect(captureOutput(result._unsafeUnwrapErr())).toEqual(
      new BodyWeightNotFoundError('missing'),
    )
  })
})
