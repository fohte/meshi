import { createSql } from '@/db'
import { runMigrations } from '@/db/migrations'
import { EnvError, requireDatabaseUrl } from '@/env'
import { setupMeshiCheckpointSchema } from '@/llm/agent/checkpointer'

// infra runs this as `node dist/db/migrate.js` in an init container.
const main = async (): Promise<void> => {
  const databaseUrl = requireDatabaseUrl()
  const sql = createSql(databaseUrl)
  try {
    await runMigrations(sql)
    await setupMeshiCheckpointSchema(databaseUrl)
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
