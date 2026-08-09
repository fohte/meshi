import { Result } from 'neverthrow'
import { z } from 'zod'

// meshi has a single user, always in Japan; every calendar date is Asia/Tokyo.
const JST_TIME_ZONE = 'Asia/Tokyo'

declare const jstDateBrand: unique symbol

// A YYYY-MM-DD string proven to be a valid JST calendar date — either by
// isValidJstCalendarDateString/jstDateSchema, or by construction
// (toJstDateString/todayJstDateString/nextJstDateString always produce a
// valid one). Every meal_logs.eaten_date/meal_skips.date field in the
// domain layer uses this instead of a plain string.
export type JstDate = string & { readonly [jstDateBrand]: true }

const tryParseJstDate = Result.fromThrowable((value: string) =>
  Temporal.PlainDate.from(value, { overflow: 'reject' }),
)

export const toJstDateString = (instant: Date): JstDate => {
  const plainDate = instant
    .toTemporalInstant()
    .toZonedDateTimeISO(JST_TIME_ZONE)
    .toPlainDate()
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Temporal.PlainDate#toString() is exactly YYYY-MM-DD for the ISO calendar; defining the JstDate brand requires asserting it here.
  return plainDate.toString() as JstDate
}

// overflow: 'reject' rejects an out-of-range day (e.g. 2026-02-30) instead
// of silently rolling it into the next month; round-tripping through
// toString() also rejects input that parses but isn't canonical YYYY-MM-DD
// (calendar annotations, non-4-digit years).
export const isValidJstCalendarDateString = (value: string): value is JstDate =>
  tryParseJstDate(value)
    .map((plainDate) => plainDate.toString() === value)
    .unwrapOr(false)

export const todayJstDateString = (now: Date): JstDate => toJstDateString(now)

// date is already a validated JstDate, so this can't hit the parse/overflow
// errors isValidJstCalendarDateString guards against.
export const nextJstDateString = (date: JstDate): JstDate =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Temporal.PlainDate#toString() is exactly YYYY-MM-DD for the ISO calendar; defining the JstDate brand requires asserting it here.
  Temporal.PlainDate.from(date).add({ days: 1 }).toString() as JstDate

// The single validating boundary for a JST calendar date coming from
// outside the process (HTTP query/body, MCP tool input, raw SQL row).
export const jstDateSchema = z.string().refine(isValidJstCalendarDateString, {
  error: (issue) =>
    `must be a valid YYYY-MM-DD JST calendar date, got: ${JSON.stringify(issue.input)}`,
})
