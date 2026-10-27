import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql, SqlOrTx } from '#db/index'
import { numericValueSchema } from '#db/numeric-value-schema'
import { DomainError, MealLogPersistenceError } from '#domain/meal-log/errors'
import {
  MEAL_TYPES,
  type MealType,
  type NutritionMap,
} from '#domain/meal-log/types'
import { type JstDate, jstDateSchema } from '#lib/jst-date'

type MealLogNutritionReassignmentErrorCode =
  | 'duplicate_meal_log_id'
  | 'invalid_meal_log_ids'
  | 'invalid_reason'
  | 'invalid_expected_versions'
  | 'meal_log_not_found'
  | 'nutrition_version_not_found'
  | 'different_food_master'
  | 'nutrition_version_unchanged'
  | 'nutrition_version_changed'

class MealLogNutritionReassignmentError extends DomainError {
  constructor(code: MealLogNutritionReassignmentErrorCode, message: string) {
    super(message, `meal_log/${code}`)
    this.name = 'MealLogNutritionReassignmentError'
  }
}

interface MealLogNutritionReassignmentInput {
  readonly mealLogIds: ReadonlyArray<string>
  readonly toNutritionVersionId: string
  readonly reason: string
  readonly apply: boolean
  readonly expectedFromVersions?: ReadonlyArray<{
    readonly mealLogId: string
    readonly nutritionVersionId: string | null
  }>
}

interface MealLogNutritionVersionSnapshot {
  readonly id: string
  readonly versionNo: number
  readonly nutrition: NutritionMap
}

interface MealLogNutritionReassignmentResult {
  readonly applied: boolean
  readonly reason: string
  readonly mealLogs: ReadonlyArray<{
    readonly id: string
    readonly foodMasterId: string
    readonly eatenDate: JstDate
    readonly mealType: MealType
    readonly quantity: number
    readonly from: MealLogNutritionVersionSnapshot | null
    readonly to: MealLogNutritionVersionSnapshot
  }>
  readonly affectedDayTotals: ReadonlyArray<{
    readonly date: JstDate
    readonly totalsBefore: NutritionMap
    readonly totalsAfter: NutritionMap
  }>
}

const targetNutritionVersionRowSchema = z.object({
  id: z.uuid(),
  food_master_id: z.string(),
  version_no: z.number().int(),
})

const mealLogRowSchema = z.object({
  id: z.string(),
  food_master_id: z.string(),
  eaten_date: jstDateSchema,
  meal_type: z.enum(MEAL_TYPES),
  quantity: numericValueSchema,
  nutrition_version_id: z.uuid().nullable(),
  nutrition_version_no: z.number().int().nullable(),
})

const nutrientRowSchema = z.object({
  nutrition_version_id: z.uuid(),
  nutrient_code: z.string(),
  value: numericValueSchema,
})

const dailyNutritionRowSchema = z.object({
  date: jstDateSchema,
  nutrient_code: z.string(),
  value: numericValueSchema,
})

const parseRows = <T extends z.ZodType>(
  schema: T,
  rows: unknown,
  queryName: string,
): Result<z.output<T>, MealLogPersistenceError> => {
  const parsed = schema.safeParse(rows)
  return parsed.success
    ? ok(parsed.data)
    : err(
        new MealLogPersistenceError(
          `${queryName} returned invalid rows: ${parsed.error.message}`,
        ),
      )
}

const readNutrition = async (
  tx: SqlOrTx,
  nutritionVersionIds: ReadonlyArray<string>,
): Promise<
  Result<ReadonlyMap<string, NutritionMap>, MealLogPersistenceError>
> => {
  const rows = await tx<Record<string, unknown>[]>`
    SELECT nutrition_version_id, nutrient_code, value
    FROM food_master_nutrients
    WHERE nutrition_version_id = ANY(${tx.array([...nutritionVersionIds])}::uuid[])
    ORDER BY nutrition_version_id, nutrient_code
  `
  const parsed = parseRows(z.array(nutrientRowSchema), rows, 'nutrition query')
  if (parsed.isErr()) return err(parsed.error)

  const maps = new Map<string, Record<string, number>>()
  for (const row of parsed.value) {
    const nutrition = maps.get(row.nutrition_version_id) ?? {}
    nutrition[row.nutrient_code] = row.value
    maps.set(row.nutrition_version_id, nutrition)
  }
  return ok(maps)
}

const readDailyTotals = async (
  tx: SqlOrTx,
  dates: ReadonlyArray<JstDate>,
  replacements?: {
    readonly mealLogIds: ReadonlyArray<string>
    readonly nutritionVersionId: string
  },
): Promise<
  Result<ReadonlyMap<JstDate, NutritionMap>, MealLogPersistenceError>
> => {
  const totals = new Map<JstDate, Record<string, number>>(
    dates.map((date) => [date, {}]),
  )
  if (dates.length === 0) return ok(totals)

  const rows =
    replacements === undefined
      ? await tx<Record<string, unknown>[]>`
          SELECT to_char(ml.eaten_date, 'YYYY-MM-DD') AS date,
                 nutrients.nutrient_code,
                 SUM(nutrients.value * ml.quantity) AS value
          FROM meal_logs AS ml
          JOIN food_master_nutrients AS nutrients
            ON nutrients.nutrition_version_id = ml.nutrition_version_id
          WHERE ml.eaten_date = ANY(${tx.array([...dates])}::date[])
          GROUP BY date, nutrients.nutrient_code
          ORDER BY date, nutrients.nutrient_code
        `
      : await tx<Record<string, unknown>[]>`
          SELECT to_char(ml.eaten_date, 'YYYY-MM-DD') AS date,
                 nutrients.nutrient_code,
                 SUM(nutrients.value * ml.quantity) AS value
          FROM meal_logs AS ml
          JOIN food_master_nutrients AS nutrients
            ON nutrients.nutrition_version_id = CASE
              WHEN ml.id = ANY(${tx.array([...replacements.mealLogIds])}::text[])
                THEN ${replacements.nutritionVersionId}::uuid
              ELSE ml.nutrition_version_id
            END
          WHERE ml.eaten_date = ANY(${tx.array([...dates])}::date[])
          GROUP BY date, nutrients.nutrient_code
          ORDER BY date, nutrients.nutrient_code
        `
  const parsed = parseRows(
    z.array(dailyNutritionRowSchema),
    rows,
    'daily nutrition totals query',
  )
  if (parsed.isErr()) return err(parsed.error)

  for (const row of parsed.value) {
    const day = totals.get(row.date)
    if (day !== undefined) day[row.nutrient_code] = row.value
  }
  return ok(totals)
}

const expectedVersionsMatch = (
  input: MealLogNutritionReassignmentInput,
): boolean => {
  if (!input.apply) return true
  const expected = input.expectedFromVersions
  if (expected === undefined || expected.length !== input.mealLogIds.length) {
    return false
  }
  const expectedById = new Map(
    expected.map(({ mealLogId, nutritionVersionId }) => [
      mealLogId,
      nutritionVersionId,
    ]),
  )
  return (
    expectedById.size === input.mealLogIds.length &&
    input.mealLogIds.every((id) => expectedById.has(id))
  )
}

const reassignInTransaction = async (
  tx: SqlOrTx,
  input: MealLogNutritionReassignmentInput,
): Promise<Result<MealLogNutritionReassignmentResult, DomainError>> => {
  const targetRows = await tx<Record<string, unknown>[]>`
    SELECT id, food_master_id, version_no
    FROM food_master_nutrition
    WHERE id = ${input.toNutritionVersionId}
  `
  const parsedTarget = parseRows(
    z.array(targetNutritionVersionRowSchema),
    targetRows,
    'target nutrition version query',
  )
  if (parsedTarget.isErr()) return err(parsedTarget.error)
  const target = parsedTarget.value[0]
  if (target === undefined) {
    return err(
      new MealLogNutritionReassignmentError(
        'nutrition_version_not_found',
        `nutrition version not found: ${input.toNutritionVersionId}`,
      ),
    )
  }

  const mealLogRows = input.apply
    ? await tx<Record<string, unknown>[]>`
    SELECT ml.id, ml.food_master_id,
           to_char(ml.eaten_date, 'YYYY-MM-DD') AS eaten_date,
           ml.meal_type, ml.quantity,
           ml.nutrition_version_id,
           current_version.version_no AS nutrition_version_no
    FROM meal_logs AS ml
    LEFT JOIN food_master_nutrition AS current_version
      ON current_version.id = ml.nutrition_version_id
    WHERE ml.id = ANY(${tx.array([...input.mealLogIds])}::text[])
    ORDER BY ml.id
    FOR UPDATE OF ml
  `
    : await tx<Record<string, unknown>[]>`
        SELECT ml.id, ml.food_master_id,
               to_char(ml.eaten_date, 'YYYY-MM-DD') AS eaten_date,
               ml.meal_type, ml.quantity,
               ml.nutrition_version_id,
               current_version.version_no AS nutrition_version_no
        FROM meal_logs AS ml
        LEFT JOIN food_master_nutrition AS current_version
          ON current_version.id = ml.nutrition_version_id
        WHERE ml.id = ANY(${tx.array([...input.mealLogIds])}::text[])
        ORDER BY ml.id
      `
  const parsedMealLogs = parseRows(
    z.array(mealLogRowSchema),
    mealLogRows,
    'meal_logs query',
  )
  if (parsedMealLogs.isErr()) return err(parsedMealLogs.error)

  const logsById = new Map(parsedMealLogs.value.map((row) => [row.id, row]))
  const missingId = input.mealLogIds.find((id) => !logsById.has(id))
  if (missingId !== undefined) {
    return err(
      new MealLogNutritionReassignmentError(
        'meal_log_not_found',
        `meal_log not found: ${missingId}`,
      ),
    )
  }
  const logs = input.mealLogIds.flatMap((id) => {
    const log = logsById.get(id)
    return log === undefined ? [] : [log]
  })

  if (logs.some((log) => log.food_master_id !== target.food_master_id)) {
    return err(
      new MealLogNutritionReassignmentError(
        'different_food_master',
        'all meal_logs and the target nutrition version must belong to the same food_master',
      ),
    )
  }

  if (input.apply) {
    const expectedById = new Map(
      input.expectedFromVersions?.map(({ mealLogId, nutritionVersionId }) => [
        mealLogId,
        nutritionVersionId,
      ]),
    )
    const changedLog = logs.find(
      (log) => expectedById.get(log.id) !== log.nutrition_version_id,
    )
    if (changedLog !== undefined) {
      return err(
        new MealLogNutritionReassignmentError(
          'nutrition_version_changed',
          `meal_log nutrition version changed since preview: ${changedLog.id}`,
        ),
      )
    }
  }

  if (logs.some((log) => log.nutrition_version_id === target.id)) {
    return err(
      new MealLogNutritionReassignmentError(
        'nutrition_version_unchanged',
        'target nutrition version is already assigned to a selected meal_log',
      ),
    )
  }

  const nutritionVersionIds = [
    target.id,
    ...logs.flatMap((log) =>
      log.nutrition_version_id === null ? [] : [log.nutrition_version_id],
    ),
  ]
  const nutritionResult = await readNutrition(tx, [
    ...new Set(nutritionVersionIds),
  ])
  if (nutritionResult.isErr()) return err(nutritionResult.error)

  const affectedDates = [
    ...new Set(logs.map((log) => log.eaten_date)),
  ].toSorted()
  const totalsBefore = await readDailyTotals(tx, affectedDates)
  if (totalsBefore.isErr()) return err(totalsBefore.error)

  if (input.apply) {
    const updatedRows = await tx<Record<string, unknown>[]>`
      UPDATE meal_logs
      SET nutrition_version_id = ${target.id},
          nutrition_version_origin = 'reassigned'
      WHERE id = ANY(${tx.array([...input.mealLogIds])}::text[])
      RETURNING id
    `
    const parsedUpdatedRows = parseRows(
      z.array(z.object({ id: z.string() })),
      updatedRows,
      'meal_logs update',
    )
    if (parsedUpdatedRows.isErr()) return err(parsedUpdatedRows.error)
    const updatedIds = new Set(parsedUpdatedRows.value.map(({ id }) => id))
    if (
      updatedIds.size !== input.mealLogIds.length ||
      input.mealLogIds.some((id) => !updatedIds.has(id))
    ) {
      return err(
        new MealLogPersistenceError(
          'meal_logs update returned an unexpected number of rows',
        ),
      )
    }

    for (const log of logs) {
      await tx`
        INSERT INTO meal_log_nutrition_changes (
          meal_log_id, from_version_id, to_version_id, reason
        ) VALUES (
          ${log.id}, ${log.nutrition_version_id}, ${target.id}, ${input.reason}
        )
      `
    }
  }

  const totalsAfter = await readDailyTotals(
    tx,
    affectedDates,
    input.apply
      ? undefined
      : {
          mealLogIds: input.mealLogIds,
          nutritionVersionId: target.id,
        },
  )
  if (totalsAfter.isErr()) return err(totalsAfter.error)

  const targetNutrition = nutritionResult.value.get(target.id) ?? {}
  return ok({
    applied: input.apply,
    reason: input.reason,
    mealLogs: logs.map((log) => ({
      id: log.id,
      foodMasterId: log.food_master_id,
      eatenDate: log.eaten_date,
      mealType: log.meal_type,
      quantity: log.quantity,
      from:
        log.nutrition_version_id === null || log.nutrition_version_no === null
          ? null
          : {
              id: log.nutrition_version_id,
              versionNo: log.nutrition_version_no,
              nutrition:
                nutritionResult.value.get(log.nutrition_version_id) ?? {},
            },
      to: {
        id: target.id,
        versionNo: target.version_no,
        nutrition: targetNutrition,
      },
    })),
    affectedDayTotals: affectedDates.map((date) => ({
      date,
      totalsBefore: totalsBefore.value.get(date) ?? {},
      totalsAfter: totalsAfter.value.get(date) ?? {},
    })),
  })
}

export interface MealLogNutritionReassignmentService {
  reassign(
    input: MealLogNutritionReassignmentInput,
  ): ResultAsync<MealLogNutritionReassignmentResult, DomainError>
}

export const createMealLogNutritionReassignmentService = (
  sql: Sql,
): MealLogNutritionReassignmentService => ({
  reassign(input) {
    if (new Set(input.mealLogIds).size !== input.mealLogIds.length) {
      return errAsync(
        new MealLogNutritionReassignmentError(
          'duplicate_meal_log_id',
          'meal_log_ids must be unique',
        ),
      )
    }
    if (input.mealLogIds.length === 0) {
      return errAsync(
        new MealLogNutritionReassignmentError(
          'invalid_meal_log_ids',
          'meal_log_ids must contain at least one id',
        ),
      )
    }
    if (input.reason.trim() === '') {
      return errAsync(
        new MealLogNutritionReassignmentError(
          'invalid_reason',
          'reason must not be empty',
        ),
      )
    }
    if (!expectedVersionsMatch(input)) {
      return errAsync(
        new MealLogNutritionReassignmentError(
          'invalid_expected_versions',
          'apply requires one expected nutrition version for every meal_log_id',
        ),
      )
    }

    return ResultAsync.fromPromise(
      sql.begin((tx) =>
        reassignInTransaction(tx, input).then((result) =>
          result.match(
            (value) => Promise.resolve(value),
            (error) => Promise.reject(error),
          ),
        ),
      ),
      (caughtError) =>
        caughtError instanceof DomainError
          ? caughtError
          : new MealLogPersistenceError(
              'failed to reassign meal_log nutrition',
              caughtError,
            ),
    )
  },
})
