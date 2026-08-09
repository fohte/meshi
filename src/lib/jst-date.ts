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

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

const tryParseJstDate = Result.fromThrowable((value: string) =>
  Temporal.PlainDate.from(value, { overflow: 'reject' }),
)

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- callers only reach this after proving value is a canonical YYYY-MM-DD JST calendar date; defining the JstDate brand requires asserting it here.
const asJstDate = (value: string): JstDate => value as JstDate

export const toJstDateString = (instant: Date): JstDate =>
  asJstDate(
    instant
      .toTemporalInstant()
      .toZonedDateTimeISO(JST_TIME_ZONE)
      .toPlainDate()
      .toString(),
  )

// The DATE_ONLY_RE check rejects input Temporal.PlainDate.from would
// otherwise accept but round-trip back unchanged — a non-ISO calendar
// annotation (e.g. "2026-07-30[u-ca=japanese]") round-trips because
// toString() preserves it. overflow: 'reject' then rejects an out-of-range
// day (e.g. 2026-02-30) instead of silently rolling it into the next month.
export const isValidJstCalendarDateString = (value: string): value is JstDate =>
  DATE_ONLY_RE.test(value) && tryParseJstDate(value).isOk()

export const todayJstDateString = (now: Date): JstDate => toJstDateString(now)

// date is already a validated JstDate, so this can't hit the parse/overflow
// errors isValidJstCalendarDateString guards against.
export const nextJstDateString = (date: JstDate): JstDate =>
  asJstDate(Temporal.PlainDate.from(date).add({ days: 1 }).toString())

// The single validating boundary for a JST calendar date coming from
// outside the process (HTTP query/body, MCP tool input, raw SQL row).
export const jstDateSchema = z.string().refine(isValidJstCalendarDateString, {
  error: (issue) =>
    `must be a valid YYYY-MM-DD JST calendar date, got: ${JSON.stringify(issue.input)}`,
})
