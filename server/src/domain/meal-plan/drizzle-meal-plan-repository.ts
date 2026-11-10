import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { err, ok, type Result, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import { numericValueSchema } from '#db/numeric-value-schema'
import { foodMasters, mealPlanItems, mealPlans } from '#db/schema'
import { MEAL_TYPES } from '#domain/meal-log/types'
import {
  type MealPlanDomainError,
  MealPlanFoodMasterNotFoundError,
  MealPlanFoodNameMismatchError,
  MealPlanPersistenceError,
} from '#domain/meal-plan/errors'
import type { MealPlanRepository } from '#domain/meal-plan/meal-plan-repository'
import type {
  MealPlan,
  MealPlanItem,
  SaveMealPlanInput,
} from '#domain/meal-plan/types'
import { jstDateSchema } from '#lib/jst-date'

type Db = ReturnType<typeof drizzle>
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]
type DbSession = Db | Transaction

export interface DrizzleMealPlanRepositoryOptions {
  readonly wrapInTransaction?: boolean
}

const mealPlanRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    date: jstDateSchema,
    mealType: z.enum(MEAL_TYPES),
    reason: z.string().nullable(),
    cancelledAt: z.date().nullable(),
    createdAt: z.date(),
    foodMasterId: z.string(),
    foodName: z.string(),
    quantity: numericValueSchema.pipe(z.number().positive()),
  }),
)

const selectPlanRows = (session: DbSession, where?: ReturnType<typeof and>) =>
  session
    .select({
      id: mealPlans.id,
      date: mealPlans.plannedDate,
      mealType: mealPlans.mealType,
      reason: mealPlans.reason,
      cancelledAt: mealPlans.cancelledAt,
      createdAt: mealPlans.createdAt,
      foodMasterId: mealPlanItems.foodMasterId,
      foodName: foodMasters.name,
      quantity: mealPlanItems.quantity,
    })
    .from(mealPlans)
    .innerJoin(mealPlanItems, eq(mealPlanItems.mealPlanId, mealPlans.id))
    .innerJoin(foodMasters, eq(foodMasters.id, mealPlanItems.foodMasterId))
    .where(where)
    .orderBy(
      asc(mealPlans.plannedDate),
      asc(mealPlans.mealType),
      asc(foodMasters.name),
      asc(foodMasters.id),
    )

const toMealPlans = (
  rawRows: unknown,
): Result<ReadonlyArray<MealPlan>, MealPlanPersistenceError> => {
  const parsed = mealPlanRowsSchema.safeParse(rawRows)
  if (!parsed.success) {
    return err(
      new MealPlanPersistenceError(
        `meal_plans query returned invalid rows: ${parsed.error.message}`,
        parsed.error,
      ),
    )
  }

  const plans = new Map<string, MealPlan>()
  for (const row of parsed.data) {
    const item: MealPlanItem = {
      foodMasterId: row.foodMasterId,
      foodName: row.foodName,
      quantity: row.quantity,
    }
    const existing = plans.get(row.id)
    if (existing === undefined) {
      plans.set(row.id, {
        id: row.id,
        date: row.date,
        mealType: row.mealType,
        items: [item],
        reason: row.reason,
        status: row.cancelledAt === null ? 'planned' : 'cancelled',
        createdAt: row.createdAt,
      })
    } else {
      plans.set(row.id, { ...existing, items: [...existing.items, item] })
    }
  }
  return ok(Array.from(plans.values()))
}

const normalizeFoodName = (name: string): string => name.trim().toLowerCase()

const findFoods = async (
  session: DbSession,
  input: SaveMealPlanInput,
): Promise<Result<void, MealPlanDomainError>> => {
  const foodRows = await session
    .select({ id: foodMasters.id, name: foodMasters.name })
    .from(foodMasters)
    .where(
      inArray(
        foodMasters.id,
        input.items.map((item) => item.foodMasterId),
      ),
    )
    .for('key share', { of: foodMasters })
  const foodsById = new Map(foodRows.map((food) => [food.id, food.name]))
  for (const item of input.items) {
    const foodName = foodsById.get(item.foodMasterId)
    if (foodName === undefined) {
      return err(new MealPlanFoodMasterNotFoundError(item.foodMasterId))
    }
    if (normalizeFoodName(item.foodName) !== normalizeFoodName(foodName)) {
      return err(new MealPlanFoodNameMismatchError(item.foodName, foodName))
    }
  }
  return ok(undefined)
}

const loadById = async (
  session: DbSession,
  id: string,
): Promise<Result<MealPlan, MealPlanPersistenceError>> => {
  const rawRows = await selectPlanRows(session, eq(mealPlans.id, id))
  return toMealPlans(rawRows).andThen((plans) => {
    const [plan] = plans
    return plan === undefined
      ? err(
          new MealPlanPersistenceError(
            `meal_plan write returned no rows: ${id}`,
          ),
        )
      : ok(plan)
  })
}

const insertItems = (
  session: DbSession,
  planId: string,
  items: SaveMealPlanInput['items'],
) =>
  session.insert(mealPlanItems).values(
    items.map((item) => ({
      mealPlanId: planId,
      foodMasterId: item.foodMasterId,
      quantity: item.quantity.toString(),
    })),
  )

export const createDrizzleMealPlanRepository = (
  pgSql: Sql,
  options: DrizzleMealPlanRepositoryOptions = {},
): MealPlanRepository => {
  const db: Db = drizzle(pgSql)
  const wrapInTransaction = options.wrapInTransaction ?? true

  const runWrite = <T>(
    operation: (session: DbSession) => Promise<Result<T, MealPlanDomainError>>,
    message: string,
  ): ResultAsync<T, MealPlanDomainError> => {
    const promise = wrapInTransaction
      ? db.transaction((tx) => operation(tx))
      : operation(db)
    return ResultAsync.fromPromise(
      promise,
      (cause) => new MealPlanPersistenceError(message, cause),
    ).andThen((result) => result)
  }

  return {
    save(input) {
      return runWrite(async (session) => {
        const foods = await findFoods(session, input)
        if (foods.isErr()) return err(foods.error)

        const [plan] = await session
          .insert(mealPlans)
          .values({
            plannedDate: input.date,
            mealType: input.mealType,
            reason: input.reason ?? null,
          })
          .onConflictDoUpdate({
            target: [mealPlans.plannedDate, mealPlans.mealType],
            targetWhere: isNull(mealPlans.cancelledAt),
            set: { reason: sql`excluded.reason` },
          })
          .returning({ id: mealPlans.id })
        if (plan === undefined) {
          return err(
            new MealPlanPersistenceError('meal_plan upsert returned no rows'),
          )
        }

        await session
          .delete(mealPlanItems)
          .where(eq(mealPlanItems.mealPlanId, plan.id))
        await insertItems(session, plan.id, input.items)
        return loadById(session, plan.id)
      }, 'failed to save meal_plan')
    },

    list(periodFrom, periodTo) {
      return ResultAsync.fromPromise(
        selectPlanRows(
          db,
          and(
            gte(mealPlans.plannedDate, periodFrom),
            lt(mealPlans.plannedDate, periodTo),
          ),
        ),
        (cause) =>
          new MealPlanPersistenceError('failed to list meal_plans', cause),
      ).andThen((rows) => toMealPlans(rows))
    },

    cancel(id) {
      return runWrite(async (session) => {
        const [updated] = await session
          .update(mealPlans)
          .set({ cancelledAt: sql`COALESCE(${mealPlans.cancelledAt}, now())` })
          .where(eq(mealPlans.id, id))
          .returning({ id: mealPlans.id })
        if (updated === undefined) return ok(null)
        return loadById(session, updated.id)
      }, 'failed to cancel meal_plan')
    },
  }
}
