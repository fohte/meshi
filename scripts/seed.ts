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
  // eslint-disable-next-line no-restricted-syntax -- standalone CLI script; try/finally only guarantees sql.end() runs, main().catch() below is the top-level failure boundary
  try {
    const foodCompositionJsonPath = values['food-composition']
    const result = await runSeed(
      sql,
      foodCompositionJsonPath === undefined ? {} : { foodCompositionJsonPath },
    )
    if (result.isErr()) {
      // eslint-disable-next-line no-restricted-syntax -- re-throws the Result's error so it surfaces through the same main().catch() path as any other startup failure in this script
      throw result.error
    }
    const foodCount = result.value.foodComposition?.foodCount
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
