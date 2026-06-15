import { readFile } from 'node:fs/promises'

import { z } from 'zod'

import type { Sql } from '@/db'
import {
  type NutrientDefinitionSeed,
  upsertNutrientDefinitions,
} from '@/db/seed/nutrient-definitions'

const foodCompositionRowSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  nutrients: z.record(z.string().min(1), z.number().nonnegative()),
})

const foodCompositionDatasetSchema = z.array(foodCompositionRowSchema)

export type FoodCompositionRow = z.infer<typeof foodCompositionRowSchema>

export interface LoadFoodCompositionOptions {
  readonly extraNutrientDefinitions?: ReadonlyArray<NutrientDefinitionSeed>
}

export interface LoadFoodCompositionResult {
  readonly foodCount: number
  readonly nutrientRowCount: number
}

export class FoodCompositionLoadError extends Error {
  constructor(
    message: string,
    public readonly missingNutrientCodes?: ReadonlyArray<string>,
  ) {
    super(message)
    this.name = 'FoodCompositionLoadError'
  }
}

export const parseFoodCompositionDataset = (
  raw: unknown,
): ReadonlyArray<FoodCompositionRow> => {
  const parsed = foodCompositionDatasetSchema.safeParse(raw)
  if (!parsed.success) {
    throw new FoodCompositionLoadError(
      `invalid food composition dataset: ${parsed.error.message}`,
    )
  }
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of parsed.data) {
    if (seen.has(row.code)) duplicates.add(row.code)
    seen.add(row.code)
  }
  if (duplicates.size > 0) {
    throw new FoodCompositionLoadError(
      `duplicate food composition codes in dataset: ${[...duplicates].sort().join(', ')}`,
    )
  }
  return parsed.data
}

export const loadFoodCompositionDatasetFromFile = async (
  path: string,
): Promise<ReadonlyArray<FoodCompositionRow>> => {
  const text = await readFile(path, 'utf8')
  const raw: unknown = JSON.parse(text)
  return parseFoodCompositionDataset(raw)
}

export const loadFoodComposition = async (
  sql: Sql,
  rows: ReadonlyArray<FoodCompositionRow>,
  options: LoadFoodCompositionOptions = {},
): Promise<LoadFoodCompositionResult> => {
  if (rows.length === 0) {
    return { foodCount: 0, nutrientRowCount: 0 }
  }

  const usedNutrientCodes = new Set<string>()
  for (const row of rows) {
    for (const code of Object.keys(row.nutrients)) {
      usedNutrientCodes.add(code)
    }
  }

  return await sql.begin(async (tx) => {
    if (
      options.extraNutrientDefinitions &&
      options.extraNutrientDefinitions.length > 0
    ) {
      await upsertNutrientDefinitions(tx, options.extraNutrientDefinitions)
    }

    if (usedNutrientCodes.size > 0) {
      const existing = await tx<{ code: string }[]>`
        SELECT code FROM nutrient_definitions
        WHERE code = ANY(${tx.array([...usedNutrientCodes])})
      `
      const known = new Set(existing.map((r) => r.code))
      const missing = [...usedNutrientCodes].filter((c) => !known.has(c)).sort()
      if (missing.length > 0) {
        throw new FoodCompositionLoadError(
          `unknown nutrient codes: ${missing.join(', ')}. ` +
            `Pass them via extraNutrientDefinitions or add to NUTRIENT_DEFINITION_SEEDS.`,
          missing,
        )
      }
    }

    const foodRows = rows.map((r) => ({ code: r.code, name: r.name }))
    await tx`
      INSERT INTO food_compositions ${tx(foodRows)}
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    `

    const codes = rows.map((r) => r.code)
    await tx`
      DELETE FROM food_composition_nutrients
      WHERE food_composition_code = ANY(${tx.array(codes)})
    `

    const nutrientRows = rows.flatMap((row) =>
      Object.entries(row.nutrients).map(([code, value]) => ({
        food_composition_code: row.code,
        nutrient_code: code,
        value: String(value),
      })),
    )

    if (nutrientRows.length > 0) {
      await tx`INSERT INTO food_composition_nutrients ${tx(nutrientRows)}`
    }

    return {
      foodCount: rows.length,
      nutrientRowCount: nutrientRows.length,
    }
  })
}
