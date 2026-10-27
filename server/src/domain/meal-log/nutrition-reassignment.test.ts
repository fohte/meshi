import { expect, it } from 'vitest'
import { z } from 'zod'

import type { Sql } from '#db/index'
import { createMealLogNutritionReassignmentService } from '#domain/meal-log/nutrition-reassignment'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import {
  seedFoodMasterNutritionVersion,
  seedFoodMasterWithoutNutrition,
  seedMealLog,
} from '#test/seed'

const observation = <T extends object>(value: T): T => value

const persistedMealLogsSchema = z.array(
  z.object({
    id: z.string(),
    food_master_id: z.string(),
    nutrition_version_id: z.string().nullable(),
    nutrition_version_origin: z.string(),
    quantity: z.string(),
    from_version_id: z.string().nullable(),
    to_version_id: z.string().nullable(),
    reason: z.string().nullable(),
  }),
)

const readPersistedMealLogs = async (
  tx: Sql,
  mealLogIds: ReadonlyArray<string>,
) => {
  const rows = await tx<Record<string, unknown>[]>`
    SELECT ml.id, ml.food_master_id, ml.nutrition_version_id,
           ml.nutrition_version_origin, ml.quantity::text AS quantity,
           changes.from_version_id, changes.to_version_id, changes.reason
    FROM meal_logs AS ml
    LEFT JOIN meal_log_nutrition_changes AS changes
      ON changes.meal_log_id = ml.id
    WHERE ml.id = ANY(${tx.array([...mealLogIds])}::text[])
    ORDER BY ml.id
  `
  return persistedMealLogsSchema.parse(rows)
}

const createVersions = async (
  tx: Sql,
  foodMasterId: string,
): Promise<{
  readonly originalVersionId: string
  readonly replacementVersionId: string
}> => {
  await seedFoodMasterWithoutNutrition(tx, {
    id: foodMasterId,
    name: `Reassignment fixture ${foodMasterId}`,
  })
  const originalVersionId = await seedFoodMasterNutritionVersion(tx, {
    foodMasterId,
    versionNo: 1,
    isCurrent: false,
    changeKind: 'initial',
    isEstimated: false,
    source: 'user_input',
    sourceUrl: null,
    sourceCompositionCode: null,
    nutrients: { energy_kcal: 100, protein_g: 5 },
  })
  const replacementVersionId = await seedFoodMasterNutritionVersion(tx, {
    foodMasterId,
    versionNo: 2,
    isCurrent: true,
    changeKind: 'correction',
    correctsVersionId: originalVersionId,
    isEstimated: false,
    source: 'user_input',
    sourceUrl: null,
    sourceCompositionCode: null,
    nutrients: { energy_kcal: 180, protein_g: 8 },
  })
  return { originalVersionId, replacementVersionId }
}

describeIfDb('MealLogNutritionReassignmentService', () => {
  const getTx = setupDrizzleTx()

  it('previews only the selected log and leaves the database unchanged', async () => {
    const tx = getTx()
    const versions = await createVersions(tx, 'fm_reassign_preview')
    await seedMealLog(tx, {
      id: 'ml_reassign_selected',
      foodMasterId: 'fm_reassign_preview',
      nutritionVersionId: versions.originalVersionId,
      eatenDate: jstDate('2026-03-16'),
      mealType: 'lunch',
      quantity: 1.5,
    })
    await seedMealLog(tx, {
      id: 'ml_reassign_older',
      foodMasterId: 'fm_reassign_preview',
      nutritionVersionId: versions.originalVersionId,
      eatenDate: jstDate('2026-03-02'),
      mealType: 'dinner',
      quantity: 2,
    })

    const preview = (
      await createMealLogNutritionReassignmentService(tx).reassign({
        mealLogIds: ['ml_reassign_selected'],
        toNutritionVersionId: versions.replacementVersionId,
        reason: 'Corrected the registered nutrition values',
        apply: false,
      })
    )._unsafeUnwrap()
    const persistedMealLogs = await readPersistedMealLogs(tx, [
      'ml_reassign_selected',
      'ml_reassign_older',
    ])

    expect(observation({ preview, persistedMealLogs })).toEqual({
      preview: {
        applied: false,
        reason: 'Corrected the registered nutrition values',
        mealLogs: [
          {
            id: 'ml_reassign_selected',
            foodMasterId: 'fm_reassign_preview',
            eatenDate: jstDate('2026-03-16'),
            mealType: 'lunch',
            quantity: 1.5,
            from: {
              id: versions.originalVersionId,
              versionNo: 1,
              nutrition: { energy_kcal: 100, protein_g: 5 },
            },
            to: {
              id: versions.replacementVersionId,
              versionNo: 2,
              nutrition: { energy_kcal: 180, protein_g: 8 },
            },
          },
        ],
        affectedDayTotals: [
          {
            date: jstDate('2026-03-16'),
            totalsBefore: { energy_kcal: 150, protein_g: 7.5 },
            totalsAfter: { energy_kcal: 270, protein_g: 12 },
          },
        ],
      },
      persistedMealLogs: [
        {
          id: 'ml_reassign_older',
          food_master_id: 'fm_reassign_preview',
          nutrition_version_id: versions.originalVersionId,
          nutrition_version_origin: 'recorded',
          quantity: '2',
          from_version_id: null,
          to_version_id: null,
          reason: null,
        },
        {
          id: 'ml_reassign_selected',
          food_master_id: 'fm_reassign_preview',
          nutrition_version_id: versions.originalVersionId,
          nutrition_version_origin: 'recorded',
          quantity: '1.5',
          from_version_id: null,
          to_version_id: null,
          reason: null,
        },
      ],
    })
  })

  it('applies a reviewed version with an unknown source and records a null from-version', async () => {
    const tx = getTx()
    const versions = await createVersions(tx, 'fm_reassign_apply')
    await seedMealLog(tx, {
      id: 'ml_reassign_apply_selected',
      foodMasterId: 'fm_reassign_apply',
      nutritionVersionId: null,
      eatenDate: jstDate('2026-03-16'),
      mealType: 'lunch',
      quantity: 1.5,
    })
    await seedMealLog(tx, {
      id: 'ml_reassign_apply_older',
      foodMasterId: 'fm_reassign_apply',
      nutritionVersionId: versions.originalVersionId,
      eatenDate: jstDate('2026-03-02'),
      mealType: 'dinner',
      quantity: 2,
    })

    const service = createMealLogNutritionReassignmentService(tx)
    const preview = (
      await service.reassign({
        mealLogIds: ['ml_reassign_apply_selected'],
        toNutritionVersionId: versions.replacementVersionId,
        reason: 'Corrected the registered nutrition values',
        apply: false,
      })
    )._unsafeUnwrap()
    const expectedFromVersions = preview.mealLogs.map((mealLog) => ({
      mealLogId: mealLog.id,
      nutritionVersionId: mealLog.from?.id ?? null,
    }))
    const applied = (
      await service.reassign({
        mealLogIds: ['ml_reassign_apply_selected'],
        toNutritionVersionId: versions.replacementVersionId,
        reason: 'Corrected the registered nutrition values',
        apply: true,
        expectedFromVersions,
      })
    )._unsafeUnwrap()
    const persistedMealLogs = await readPersistedMealLogs(tx, [
      'ml_reassign_apply_selected',
      'ml_reassign_apply_older',
    ])

    expect(observation({ preview, applied, persistedMealLogs })).toEqual({
      preview: {
        applied: false,
        reason: 'Corrected the registered nutrition values',
        mealLogs: [
          {
            id: 'ml_reassign_apply_selected',
            foodMasterId: 'fm_reassign_apply',
            eatenDate: jstDate('2026-03-16'),
            mealType: 'lunch',
            quantity: 1.5,
            from: null,
            to: {
              id: versions.replacementVersionId,
              versionNo: 2,
              nutrition: { energy_kcal: 180, protein_g: 8 },
            },
          },
        ],
        affectedDayTotals: [
          {
            date: jstDate('2026-03-16'),
            totalsBefore: {},
            totalsAfter: { energy_kcal: 270, protein_g: 12 },
          },
        ],
      },
      applied: {
        applied: true,
        reason: 'Corrected the registered nutrition values',
        mealLogs: [
          {
            id: 'ml_reassign_apply_selected',
            foodMasterId: 'fm_reassign_apply',
            eatenDate: jstDate('2026-03-16'),
            mealType: 'lunch',
            quantity: 1.5,
            from: null,
            to: {
              id: versions.replacementVersionId,
              versionNo: 2,
              nutrition: { energy_kcal: 180, protein_g: 8 },
            },
          },
        ],
        affectedDayTotals: [
          {
            date: jstDate('2026-03-16'),
            totalsBefore: {},
            totalsAfter: { energy_kcal: 270, protein_g: 12 },
          },
        ],
      },
      persistedMealLogs: [
        {
          id: 'ml_reassign_apply_older',
          food_master_id: 'fm_reassign_apply',
          nutrition_version_id: versions.originalVersionId,
          nutrition_version_origin: 'recorded',
          quantity: '2',
          from_version_id: null,
          to_version_id: null,
          reason: null,
        },
        {
          id: 'ml_reassign_apply_selected',
          food_master_id: 'fm_reassign_apply',
          nutrition_version_id: versions.replacementVersionId,
          nutrition_version_origin: 'reassigned',
          quantity: '1.5',
          from_version_id: null,
          to_version_id: versions.replacementVersionId,
          reason: 'Corrected the registered nutrition values',
        },
      ],
    })
  })

  it('rejects every selected log when the replacement belongs to another food', async () => {
    const tx = getTx()
    const sourceVersions = await createVersions(
      tx,
      'fm_reassign_foreign_source',
    )
    const targetVersions = await createVersions(
      tx,
      'fm_reassign_foreign_target',
    )
    await seedMealLog(tx, {
      id: 'ml_reassign_foreign_first',
      foodMasterId: 'fm_reassign_foreign_source',
      nutritionVersionId: sourceVersions.originalVersionId,
      eatenDate: jstDate('2026-03-16'),
      mealType: 'lunch',
      quantity: 1,
    })
    await seedMealLog(tx, {
      id: 'ml_reassign_foreign_second',
      foodMasterId: 'fm_reassign_foreign_source',
      nutritionVersionId: sourceVersions.originalVersionId,
      eatenDate: jstDate('2026-03-17'),
      mealType: 'dinner',
      quantity: 2,
    })

    const outcome = await createMealLogNutritionReassignmentService(tx)
      .reassign({
        mealLogIds: ['ml_reassign_foreign_first', 'ml_reassign_foreign_second'],
        toNutritionVersionId: targetVersions.replacementVersionId,
        reason: 'Reassigned to a verified product version',
        apply: true,
        expectedFromVersions: [
          {
            mealLogId: 'ml_reassign_foreign_first',
            nutritionVersionId: sourceVersions.originalVersionId,
          },
          {
            mealLogId: 'ml_reassign_foreign_second',
            nutritionVersionId: sourceVersions.originalVersionId,
          },
        ],
      })
      .match(
        (value) => ({ success: value }),
        (error) => ({
          error: { name: error.name, code: error.code, message: error.message },
        }),
      )
    const persistedMealLogs = await readPersistedMealLogs(tx, [
      'ml_reassign_foreign_first',
      'ml_reassign_foreign_second',
    ])

    expect(observation({ outcome, persistedMealLogs })).toEqual({
      outcome: {
        error: {
          name: 'MealLogNutritionReassignmentError',
          code: 'meal_log/different_food_master',
          message:
            'all meal_logs and the target nutrition version must belong to the same food_master',
        },
      },
      persistedMealLogs: [
        {
          id: 'ml_reassign_foreign_first',
          food_master_id: 'fm_reassign_foreign_source',
          nutrition_version_id: sourceVersions.originalVersionId,
          nutrition_version_origin: 'recorded',
          quantity: '1',
          from_version_id: null,
          to_version_id: null,
          reason: null,
        },
        {
          id: 'ml_reassign_foreign_second',
          food_master_id: 'fm_reassign_foreign_source',
          nutrition_version_id: sourceVersions.originalVersionId,
          nutrition_version_origin: 'recorded',
          quantity: '2',
          from_version_id: null,
          to_version_id: null,
          reason: null,
        },
      ],
    })
  })

  it('rejects every selected log when one already uses the replacement version', async () => {
    const tx = getTx()
    const versions = await createVersions(tx, 'fm_reassign_unchanged')
    await seedMealLog(tx, {
      id: 'ml_reassign_unchanged_current',
      foodMasterId: 'fm_reassign_unchanged',
      nutritionVersionId: versions.replacementVersionId,
      eatenDate: jstDate('2026-03-16'),
      mealType: 'lunch',
      quantity: 1,
    })
    await seedMealLog(tx, {
      id: 'ml_reassign_unchanged_other',
      foodMasterId: 'fm_reassign_unchanged',
      nutritionVersionId: versions.originalVersionId,
      eatenDate: jstDate('2026-03-17'),
      mealType: 'dinner',
      quantity: 2,
    })

    const outcome = await createMealLogNutritionReassignmentService(tx)
      .reassign({
        mealLogIds: [
          'ml_reassign_unchanged_current',
          'ml_reassign_unchanged_other',
        ],
        toNutritionVersionId: versions.replacementVersionId,
        reason: 'Reassigned to a verified product version',
        apply: true,
        expectedFromVersions: [
          {
            mealLogId: 'ml_reassign_unchanged_current',
            nutritionVersionId: versions.replacementVersionId,
          },
          {
            mealLogId: 'ml_reassign_unchanged_other',
            nutritionVersionId: versions.originalVersionId,
          },
        ],
      })
      .match(
        (value) => ({ success: value }),
        (error) => ({
          error: { name: error.name, code: error.code, message: error.message },
        }),
      )
    const persistedMealLogs = await readPersistedMealLogs(tx, [
      'ml_reassign_unchanged_current',
      'ml_reassign_unchanged_other',
    ])

    expect(observation({ outcome, persistedMealLogs })).toEqual({
      outcome: {
        error: {
          name: 'MealLogNutritionReassignmentError',
          code: 'meal_log/nutrition_version_unchanged',
          message:
            'target nutrition version is already assigned to a selected meal_log',
        },
      },
      persistedMealLogs: [
        {
          id: 'ml_reassign_unchanged_current',
          food_master_id: 'fm_reassign_unchanged',
          nutrition_version_id: versions.replacementVersionId,
          nutrition_version_origin: 'recorded',
          quantity: '1',
          from_version_id: null,
          to_version_id: null,
          reason: null,
        },
        {
          id: 'ml_reassign_unchanged_other',
          food_master_id: 'fm_reassign_unchanged',
          nutrition_version_id: versions.originalVersionId,
          nutrition_version_origin: 'recorded',
          quantity: '2',
          from_version_id: null,
          to_version_id: null,
          reason: null,
        },
      ],
    })
  })

  it('rejects the whole apply when any expected version has changed', async () => {
    const tx = getTx()
    const versions = await createVersions(tx, 'fm_reassign_conflict')
    const thirdVersionId = await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_reassign_conflict',
      versionNo: 3,
      isCurrent: false,
      changeKind: 'correction',
      correctsVersionId: versions.replacementVersionId,
      isEstimated: false,
      source: 'user_input',
      sourceUrl: null,
      sourceCompositionCode: null,
      nutrients: { energy_kcal: 210, protein_g: 9 },
    })
    await seedMealLog(tx, {
      id: 'ml_reassign_conflict_first',
      foodMasterId: 'fm_reassign_conflict',
      nutritionVersionId: versions.originalVersionId,
      eatenDate: jstDate('2026-03-16'),
      mealType: 'lunch',
      quantity: 1,
    })
    await seedMealLog(tx, {
      id: 'ml_reassign_conflict_changed',
      foodMasterId: 'fm_reassign_conflict',
      nutritionVersionId: versions.replacementVersionId,
      eatenDate: jstDate('2026-03-17'),
      mealType: 'dinner',
      quantity: 2,
    })

    const outcome = await createMealLogNutritionReassignmentService(tx)
      .reassign({
        mealLogIds: [
          'ml_reassign_conflict_first',
          'ml_reassign_conflict_changed',
        ],
        toNutritionVersionId: thirdVersionId,
        reason: 'Corrected the registered nutrition values',
        apply: true,
        expectedFromVersions: [
          {
            mealLogId: 'ml_reassign_conflict_first',
            nutritionVersionId: versions.originalVersionId,
          },
          {
            mealLogId: 'ml_reassign_conflict_changed',
            nutritionVersionId: versions.originalVersionId,
          },
        ],
      })
      .match(
        (value) => ({ success: value }),
        (error) => ({
          error: { name: error.name, code: error.code, message: error.message },
        }),
      )
    const persistedMealLogs = await readPersistedMealLogs(tx, [
      'ml_reassign_conflict_first',
      'ml_reassign_conflict_changed',
    ])

    expect(observation({ outcome, persistedMealLogs })).toEqual({
      outcome: {
        error: {
          name: 'MealLogNutritionReassignmentError',
          code: 'meal_log/nutrition_version_changed',
          message:
            'meal_log nutrition version changed since preview: ml_reassign_conflict_changed',
        },
      },
      persistedMealLogs: [
        {
          id: 'ml_reassign_conflict_changed',
          food_master_id: 'fm_reassign_conflict',
          nutrition_version_id: versions.replacementVersionId,
          nutrition_version_origin: 'recorded',
          quantity: '2',
          from_version_id: null,
          to_version_id: null,
          reason: null,
        },
        {
          id: 'ml_reassign_conflict_first',
          food_master_id: 'fm_reassign_conflict',
          nutrition_version_id: versions.originalVersionId,
          nutrition_version_origin: 'recorded',
          quantity: '1',
          from_version_id: null,
          to_version_id: null,
          reason: null,
        },
      ],
    })
  })
})
