import { asc, desc } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { ResultAsync } from 'neverthrow'

import type { Sql } from '#db/index'
import { nutrientDefinitions } from '#db/schema'
import {
  type NutrientDefinition,
  NutrientDefinitionQueryError,
  type NutrientDefinitionRepository,
} from '#domain/nutrient-definition/types'

export const createDrizzleNutrientDefinitionRepository = (
  sql: Sql,
): NutrientDefinitionRepository => {
  const db = drizzle(sql)

  return {
    list: () =>
      ResultAsync.fromPromise(
        db
          .select()
          .from(nutrientDefinitions)
          .orderBy(
            desc(nutrientDefinitions.isMajor),
            asc(nutrientDefinitions.sortOrder),
          ),
        (caughtErr) =>
          new NutrientDefinitionQueryError(
            'failed to list nutrient_definitions',
            caughtErr,
          ),
      ).map((rows): ReadonlyArray<NutrientDefinition> =>
        rows.map((row) => ({
          code: row.code,
          displayName: row.displayName,
          unit: row.unit,
          isMajor: row.isMajor,
          sortOrder: row.sortOrder,
        })),
      ),
  }
}
