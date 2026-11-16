import { asc } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { z } from 'zod'

import { createSql } from '#db/index'
import { bodyWeights } from '#db/schema'
import { bodyWeightKgSchema } from '#domain/body-weight/value-schema'
import { EnvError, requireDatabaseUrl } from '#env'
import { jstDateSchema } from '#lib/jst-date'
import { evaluateWeightOutlook } from '#scripts/weight-outlook-evaluation'

const bodyWeightRowSchema = z.object({
  id: z.string(),
  measuredDate: jstDateSchema,
  measuredAt: z.date().nullable(),
  weightKg: z.coerce.number().pipe(bodyWeightKgSchema),
  createdAt: z.date(),
  updatedAt: z.date(),
})

class WeightOutlookEvaluationDataError extends Error {
  constructor(cause: unknown) {
    super('invalid body weight row returned by the database', { cause })
    this.name = 'WeightOutlookEvaluationDataError'
  }
}

const formatMetric = (value: number | null): string =>
  value === null ? '-' : value.toFixed(3)

const formatCoverage = (value: number | null): string =>
  value === null ? '-' : `${(value * 100).toFixed(1)}%`

const main = async (): Promise<void> => {
  const sql = createSql(requireDatabaseUrl())
  // eslint-disable-next-line no-restricted-syntax -- the standalone script must close its read-only database connection on both success and failure
  try {
    const db = drizzle(sql)
    const rows = await db
      .select()
      .from(bodyWeights)
      .orderBy(
        asc(bodyWeights.measuredDate),
        asc(bodyWeights.measuredAt),
        asc(bodyWeights.createdAt),
      )
    const parsedRows = z.array(bodyWeightRowSchema).safeParse(rows)
    if (!parsedRows.success) {
      // eslint-disable-next-line no-restricted-syntax -- surfaces a typed database boundary error through this CLI's main().catch() handler
      throw new WeightOutlookEvaluationDataError(parsedRows.error)
    }

    const weights = parsedRows.data.map((row) => ({
      id: row.id,
      date: row.measuredDate,
      measuredAt: row.measuredAt,
      weightKg: row.weightKg,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
    const report = evaluateWeightOutlook(weights)

    console.log(
      `Weight outlook rolling-origin evaluation\n` +
        `First measurement: ${report.firstMeasurementDate ?? '-'}\n` +
        `Last measurement: ${report.lastMeasurementDate ?? '-'}\n` +
        `Validation starts: ${report.validationStartDate ?? '-'}\n` +
        `Insufficient origins skipped: ${String(report.skippedInsufficientOrigins)}`,
    )

    for (const period of report.periods) {
      console.log(`\n${period.name}`)
      console.log(
        '| Days ahead | Forecast | Samples | Non-overlap origins | MAE (kg) | 80% coverage | Mean interval width (kg) | Misses |',
      )
      console.log('| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |')
      for (const horizon of period.horizons) {
        for (const [name, metrics] of [
          ['trend', horizon.trend],
          ['last-value baseline', horizon.baseline],
        ] as const) {
          console.log(
            `| ${String(horizon.daysAhead)} | ${name} | ${String(metrics.sampleCount)} | ${String(horizon.nonOverlappingSampleCount)} | ${formatMetric(metrics.maeKg)} | ${formatCoverage(metrics.coverage)} | ${formatMetric(metrics.meanIntervalWidthKg)} | ${String(metrics.misses)} |`,
          )
        }
      }
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  if (error instanceof EnvError) {
    for (const issue of error.issues) console.error(issue)
  } else {
    console.error(error)
  }
  process.exit(1)
})
