import { sql } from 'drizzle-orm'
import {
  check,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

export const userProfiles = pgTable(
  'user_profiles',
  {
    id: smallint('id').primaryKey().default(1),
    likes: text('likes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dislikes: text('dislikes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    allergies: text('allergies')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    constraints: text('constraints')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dailyTargets: jsonb('daily_targets').$type<Record<string, number>>(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check('user_profiles_singleton', sql`${table.id} = 1`),
    check(
      'user_profiles_daily_targets_object',
      sql`${table.dailyTargets} IS NULL OR jsonb_typeof(${table.dailyTargets}) = 'object'`,
    ),
  ],
)
