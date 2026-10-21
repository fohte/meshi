import { jstDateSchema } from '#lib/jst-date'

// Test-only literal-to-JstDate cast: throws on an invalid date instead of
// returning a Result, since a bad literal in test setup is a test bug, not a
// case under test.
export const jstDate = (value: string) => jstDateSchema.parse(value)
