import { z } from 'zod'

// z.number() rejects NaN and Infinity by default in zod v4, so it is safe to
// reuse this schema on the MCP input boundary (update_profile.daily_targets).
export const nutritionMap = z.record(z.string().min(1), z.number())
