import { pathToFileURL } from 'node:url'

import { createSql } from '@/db'
import { runMigrations } from '@/db/migrations'
import { EnvError } from '@/env'

// infra runs this file directly as `node dist/db/migrate.js` in an init
// container. This guard keeps that behavior scoped to direct invocation
// so importing runMigrations elsewhere (e.g. main.ts) doesn't also trigger it.
const isCliInvocation =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isCliInvocation) {
  const main = async (): Promise<void> => {
    const databaseUrl = process.env['DATABASE_URL']
    if (databaseUrl === undefined || databaseUrl === '') {
      throw new EnvError(['missing required env: DATABASE_URL'])
    }

    const sql = createSql(databaseUrl)
    try {
      await runMigrations(sql)
      console.log('migrations applied')
    } finally {
      await sql.end({ timeout: 5 })
    }
  }

  main().catch((err: unknown) => {
    if (err instanceof EnvError) {
      for (const issue of err.issues) console.error(issue)
    } else {
      console.error(err)
    }
    process.exit(1)
  })
}
