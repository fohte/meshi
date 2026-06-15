import { eq, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import {
  foodMasterAliases,
  foodMasterNutrients,
  foodMasters,
  nutrientDefinitions,
} from '@/db/schema'
import { FoodMasterDomainError } from '@/domain/food-master/errors'
import { defaultIdGenerator, type IdGenerator } from '@/domain/food-master/id'
import type {
  FoodMaster,
  FoodMasterId,
  NutritionMap,
  RegisterFoodMasterInput,
} from '@/domain/food-master/types'

export interface FoodMasterRepository {
  register(input: RegisterFoodMasterInput): Promise<FoodMaster>
  findById(id: FoodMasterId): Promise<FoodMaster | null>
}

export interface CreateRepositoryOptions {
  readonly generateId?: IdGenerator
}

const PG_UNIQUE_VIOLATION = '23505'

const FOOD_MASTERS_NAME_CONSTRAINT = 'food_masters_name_key'
const FOOD_MASTER_ALIASES_ALIAS_CONSTRAINT = 'food_master_aliases_alias_key'

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  err.code === PG_UNIQUE_VIOLATION

const getConstraintName = (err: unknown): string | undefined => {
  if (typeof err !== 'object' || err === null) return undefined
  if ('constraint_name' in err && typeof err.constraint_name === 'string') {
    return err.constraint_name
  }
  return undefined
}

const assertInvariants = (input: RegisterFoodMasterInput): void => {
  if (input.name.trim() === '') {
    throw new FoodMasterDomainError('empty_name', 'name must not be empty')
  }
  if (input.isEstimated && input.source === 'web_search') {
    throw new FoodMasterDomainError(
      'invalid_source_combination',
      "is_estimated=true must not be combined with source='web_search'",
      { source: input.source, isEstimated: input.isEstimated },
    )
  }
  for (const [code, value] of Object.entries(input.nutrition)) {
    if (value < 0 || Number.isNaN(value)) {
      throw new FoodMasterDomainError(
        'negative_nutrient_value',
        `nutrient value must be non-negative (code=${code}, value=${String(value)})`,
        { code, value },
      )
    }
  }
  const aliases = input.aliases ?? []
  if (aliases.some((a) => a === '')) {
    throw new FoodMasterDomainError(
      'empty_alias',
      'alias must not be empty string',
    )
  }
  if (new Set(aliases).size !== aliases.length) {
    throw new FoodMasterDomainError(
      'duplicate_alias_in_input',
      'aliases must not contain duplicates within the same input',
      { aliases },
    )
  }
}

const toNutritionMap = (
  rows: ReadonlyArray<{ nutrientCode: string; value: string }>,
): NutritionMap => {
  const map: Record<string, number> = {}
  for (const row of rows) {
    map[row.nutrientCode] = Number(row.value)
  }
  return map
}

export const createFoodMasterRepository = (
  db: PostgresJsDatabase,
  options: CreateRepositoryOptions = {},
): FoodMasterRepository => {
  const generateId = options.generateId ?? defaultIdGenerator

  const register = async (
    input: RegisterFoodMasterInput,
  ): Promise<FoodMaster> => {
    assertInvariants(input)

    const nutrientCodes = Object.keys(input.nutrition)
    const aliases = input.aliases ?? []
    const id = generateId('fm')

    try {
      return await db.transaction(async (tx) => {
        if (nutrientCodes.length > 0) {
          const known = await tx
            .select({ code: nutrientDefinitions.code })
            .from(nutrientDefinitions)
            .where(inArray(nutrientDefinitions.code, nutrientCodes))
          const knownSet = new Set(known.map((r) => r.code))
          const unknown = nutrientCodes.filter((c) => !knownSet.has(c))
          if (unknown.length > 0) {
            throw new FoodMasterDomainError(
              'unknown_nutrient_code',
              `nutrient_code not registered in nutrient_definitions: ${unknown.join(', ')}`,
              { unknown },
            )
          }
        }

        const [inserted] = await tx
          .insert(foodMasters)
          .values({
            id,
            name: input.name,
            isEstimated: input.isEstimated,
            source: input.source,
            sourceUrl: input.sourceUrl ?? null,
          })
          .returning()

        if (inserted === undefined) {
          throw new Error('failed to insert food_master row')
        }

        if (aliases.length > 0) {
          await tx.insert(foodMasterAliases).values(
            aliases.map((alias) => ({
              id: generateId('fma'),
              foodMasterId: id,
              alias,
            })),
          )
        }

        if (nutrientCodes.length > 0) {
          await tx.insert(foodMasterNutrients).values(
            nutrientCodes.map((code) => ({
              foodMasterId: id,
              nutrientCode: code,
              value: String(input.nutrition[code]),
            })),
          )
        }

        return {
          id: inserted.id,
          name: inserted.name,
          aliases,
          isEstimated: inserted.isEstimated,
          source: inserted.source,
          sourceUrl: inserted.sourceUrl,
          nutrition: input.nutrition,
          createdAt: inserted.createdAt,
        }
      })
    } catch (err) {
      if (isUniqueViolation(err)) {
        const constraint = getConstraintName(err)
        if (constraint === FOOD_MASTERS_NAME_CONSTRAINT) {
          throw new FoodMasterDomainError(
            'duplicate_name',
            `food_master with name already exists: ${input.name}`,
            { name: input.name },
          )
        }
        if (constraint === FOOD_MASTER_ALIASES_ALIAS_CONSTRAINT) {
          throw new FoodMasterDomainError(
            'duplicate_alias',
            'one or more aliases already belong to another food_master',
            { aliases: input.aliases ?? [] },
          )
        }
      }
      throw err
    }
  }

  const findById = async (id: FoodMasterId): Promise<FoodMaster | null> => {
    const [row] = await db
      .select()
      .from(foodMasters)
      .where(eq(foodMasters.id, id))
    if (row === undefined) return null

    const aliasRows = await db
      .select({ alias: foodMasterAliases.alias })
      .from(foodMasterAliases)
      .where(eq(foodMasterAliases.foodMasterId, id))

    const nutrientRows = await db
      .select({
        nutrientCode: foodMasterNutrients.nutrientCode,
        value: foodMasterNutrients.value,
      })
      .from(foodMasterNutrients)
      .where(eq(foodMasterNutrients.foodMasterId, id))

    return {
      id: row.id,
      name: row.name,
      aliases: aliasRows.map((r) => r.alias),
      isEstimated: row.isEstimated,
      source: row.source,
      sourceUrl: row.sourceUrl,
      nutrition: toNutritionMap(nutrientRows),
      createdAt: row.createdAt,
    }
  }

  return { register, findById }
}
