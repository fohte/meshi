import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { err, ok, type Result } from 'neverthrow'

import { mealLogs, mealPlans } from '#db/schema'
import {
  CancelledMealPlanError,
  DomainError,
  MealPlanAlreadyEatenError,
  MealPlanDateMismatchError,
  MealPlanMealTypeMismatchError,
  MealPlanNotFoundForMealLogError,
} from '#domain/meal-log/errors'
import type { InsertMealLogInput } from '#domain/meal-log/meal-log-repository'

type Db = ReturnType<typeof drizzle>
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]

export const validateMealPlanForRecord = async (
  session: Transaction,
  input: InsertMealLogInput,
  mealPlanId: string,
): Promise<Result<void, DomainError>> => {
  const [plan] = await session
    .select({
      id: mealPlans.id,
      date: mealPlans.plannedDate,
      mealType: mealPlans.mealType,
      cancelledAt: mealPlans.cancelledAt,
    })
    .from(mealPlans)
    .where(eq(mealPlans.id, mealPlanId))
    .for('update', { of: mealPlans })
  if (plan === undefined) {
    return err(new MealPlanNotFoundForMealLogError(mealPlanId))
  }
  if (plan.cancelledAt !== null)
    return err(new CancelledMealPlanError(mealPlanId))
  if (plan.date !== input.eatenDate) {
    return err(new MealPlanDateMismatchError(mealPlanId))
  }
  if (plan.mealType !== input.mealType) {
    return err(new MealPlanMealTypeMismatchError(mealPlanId))
  }
  const [existingLog] = await session
    .select({ id: mealLogs.id })
    .from(mealLogs)
    .where(eq(mealLogs.mealPlanId, mealPlanId))
    .limit(1)
  return existingLog === undefined
    ? ok(undefined)
    : err(new MealPlanAlreadyEatenError(mealPlanId))
}
