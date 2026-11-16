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

export const bodyCompositions = pgTable(
  'body_compositions',
  {
    id: text('id').primaryKey(),
    measuredDate: date('measured_date', { mode: 'string' })
      .$type<JstDate>()
      .notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true, mode: 'date' }),
    device: text('device').notNull(),
    bodyFatPercent: numeric('body_fat_percent', { precision: 4, scale: 2 }),
    muscleMassKg: numeric('muscle_mass_kg', { precision: 5, scale: 2 }),
    skeletalMusclePercent: numeric('skeletal_muscle_percent', {
      precision: 4,
      scale: 2,
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      'body_compositions_body_fat_percent_range',
      sql`${table.bodyFatPercent} IS NULL OR ${table.bodyFatPercent} BETWEEN 1 AND 75`,
    ),
    check(
      'body_compositions_muscle_mass_kg_range',
      sql`${table.muscleMassKg} IS NULL OR ${table.muscleMassKg} BETWEEN 5 AND 200`,
    ),
    check(
      'body_compositions_skeletal_muscle_percent_range',
      sql`${table.skeletalMusclePercent} IS NULL OR ${table.skeletalMusclePercent} BETWEEN 1 AND 75`,
    ),
    unique('body_compositions_measurement_key')
      .on(
        table.measuredDate,
        table.measuredAt,
        table.device,
        table.bodyFatPercent,
        table.muscleMassKg,
        table.skeletalMusclePercent,
      )
      .nullsNotDistinct(),
    check(
      'body_compositions_has_value',
      sql`num_nonnulls(${table.bodyFatPercent}, ${table.muscleMassKg}, ${table.skeletalMusclePercent}) >= 1`,
    ),
  ],
)
