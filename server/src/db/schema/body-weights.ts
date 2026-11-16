import { sql } from 'drizzle-orm'
import {
  check,
  date,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import type { JstDate } from '#lib/jst-date'

export const bodyWeights = pgTable(
  'body_weights',
  {
    id: text('id').primaryKey(),
    measuredDate: date('measured_date', { mode: 'string' })
      .$type<JstDate>()
      .notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true, mode: 'date' }),
    weightKg: numeric('weight_kg', { precision: 5, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique('body_weights_measured_date_measured_at_weight_kg_key')
      .on(table.measuredDate, table.measuredAt, table.weightKg)
      .nullsNotDistinct(),
    check('body_weights_weight_kg_positive', sql`${table.weightKg} > 0`),
  ],
)
