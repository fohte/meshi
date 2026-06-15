import { parseArgs } from 'node:util'

import { createSql } from '@/db'
import { runSeed } from '@/db/seed'
import { EnvError, loadEnv } from '@/env'

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      'food-composition': { type: 'string' },
    },
  })

  const env = loadEnv()
  const sql = createSql(env.DATABASE_URL)
  try {
    const foodCompositionJsonPath = values['food-composition']
    const result = await runSeed(
      sql,
      foodCompositionJsonPath === undefined ? {} : { foodCompositionJsonPath },
    )
    const foodCount = result.foodComposition?.foodCount
    console.log(
      `seeded nutrient_definitions; food_compositions=${foodCount === undefined ? 'skipped' : String(foodCount)}`,
    )
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
