import { expect, it } from 'vitest'
import { z } from 'zod'

import { createFoodMasterRepository } from '#domain/food-master/repository'
import { createFoodMasterService } from '#domain/food-master/service'
import type {
  AddFoodMasterNutritionVersionInput,
  FoodMasterNutritionVersion,
} from '#domain/food-master/types'
import { describeIfDb, setupTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import {
  seedFoodComposition,
  seedFoodMasterNutritionVersion,
  seedFoodMasterWithoutNutrition,
  seedMealLog,
  seedNutrientDefinition,
} from '#test/seed'

const observation = <T extends object>(value: T): T => value

const normalizeVersion = (
  version: FoodMasterNutritionVersion,
  versionLabels: ReadonlyMap<string, string>,
) => ({
  id: versionLabels.get(version.id) ?? '<unknown-version>',
  foodMasterId: version.foodMasterId,
  versionNo: version.versionNo,
  changeKind: version.changeKind,
  correctsVersionId:
    version.correctsVersionId === null
      ? null
      : (versionLabels.get(version.correctsVersionId) ?? '<unknown-version>'),
  isCurrent: version.isCurrent,
  servingBasis: version.servingBasis,
  netContent: version.netContent,
  nutrition: version.nutrition,
  source: version.source,
  sourceUrl: version.sourceUrl,
  sourceCompositionCode: version.sourceCompositionCode,
  isEstimated: version.isEstimated,
  checkedOn: version.checkedOn,
  effectiveFrom: version.effectiveFrom,
  reason: version.reason,
  mealLogCount: version.mealLogCount,
})

describeIfDb('food master nutrition versions', () => {
  const getTx = setupTx()

  it('rejects invalid version change metadata before persistence', async () => {
    const tx = getTx()
    const service = createFoodMasterService(
      createFoodMasterRepository(tx, { wrapInTransaction: false }),
    )
    const common = {
      foodMasterId: 'fm_invalid_version_change',
      nutrition: { energy_kcal: 10 },
      source: 'user_input' as const,
      isEstimated: false,
    }
    const invalidInputs: ReadonlyArray<AddFoodMasterNutritionVersionInput> = [
      { ...common, changeKind: 'product_update' },
      {
        ...common,
        changeKind: 'product_update',
        checkedOn: '2026-07-12',
        correctsVersionId: 'synthetic_version_id',
      },
      {
        ...common,
        changeKind: 'product_update',
        checkedOn: '2026-07-12',
        reason: 'not a correction',
      },
      {
        ...common,
        changeKind: 'correction',
        reason: 'synthetic correction',
      },
      {
        ...common,
        changeKind: 'correction',
        correctsVersionId: ' ',
        reason: 'synthetic correction',
      },
      {
        ...common,
        changeKind: 'correction',
        correctsVersionId: 'synthetic_version_id',
      },
      {
        ...common,
        changeKind: 'correction',
        correctsVersionId: 'synthetic_version_id',
        reason: '  ',
      },
    ]

    const results = await Promise.all(
      invalidInputs.map((input) =>
        service.addNutritionVersion(input).match(
          () => null,
          (error) => ({
            code: error.code,
            message: error.message,
            details: error.details,
          }),
        ),
      ),
    )

    expect(observation(results)).toEqual([
      {
        code: 'invalid_nutrition_version_change',
        message: "change_kind='product_update' requires checked_on",
        details: {},
      },
      {
        code: 'invalid_nutrition_version_change',
        message:
          "change_kind='product_update' must not include corrects_version_id or reason",
        details: {},
      },
      {
        code: 'invalid_nutrition_version_change',
        message:
          "change_kind='product_update' must not include corrects_version_id or reason",
        details: {},
      },
      {
        code: 'invalid_nutrition_version_change',
        message: "change_kind='correction' requires corrects_version_id",
        details: {},
      },
      {
        code: 'invalid_nutrition_version_change',
        message: "change_kind='correction' requires corrects_version_id",
        details: {},
      },
      {
        code: 'invalid_nutrition_version_change',
        message: "change_kind='correction' requires reason",
        details: {},
      },
      {
        code: 'invalid_nutrition_version_change',
        message: "change_kind='correction' requires reason",
        details: {},
      },
    ])
  })

  it('adds a product update without changing past logs or daily totals', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_version_product',
      name: 'sample pantry item',
    })
    const initialVersionId = await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_version_product',
      versionNo: 1,
      isCurrent: true,
      changeKind: 'initial',
      source: 'user_input',
      isEstimated: false,
      nutrients: { energy_kcal: 100, protein_g: 5 },
    })
    await seedMealLog(tx, {
      id: 'ml_version_product',
      foodMasterId: 'fm_version_product',
      nutritionVersionId: initialVersionId,
      eatenDate: jstDate('2026-07-11'),
      mealType: 'lunch',
      quantity: 1.5,
    })

    const service = createFoodMasterService(
      createFoodMasterRepository(tx, { wrapInTransaction: false }),
    )
    const readSnapshot = async () => {
      const rawLogs = await tx<Record<string, unknown>[]>`
        SELECT id, food_master_id, nutrition_version_id, quantity::text AS quantity
        FROM meal_logs
        WHERE food_master_id = 'fm_version_product'
        ORDER BY id
      `
      const logs = z
        .array(
          z.object({
            id: z.string(),
            food_master_id: z.string(),
            nutrition_version_id: z.string(),
            quantity: z.string(),
          }),
        )
        .parse(rawLogs)
      const rawTotals = await tx<Record<string, unknown>[]>`
        SELECT to_char(meal_log.eaten_date, 'YYYY-MM-DD') AS date,
               nutrient.nutrient_code,
               SUM(nutrient.value * meal_log.quantity)::text AS value
        FROM meal_logs AS meal_log
        JOIN food_master_nutrients AS nutrient
          ON nutrient.nutrition_version_id = meal_log.nutrition_version_id
        WHERE meal_log.food_master_id = 'fm_version_product'
        GROUP BY meal_log.eaten_date, nutrient.nutrient_code
        ORDER BY meal_log.eaten_date, nutrient.nutrient_code
      `
      const totals = z
        .array(
          z.object({
            date: z.string(),
            nutrient_code: z.string(),
            value: z.string(),
          }),
        )
        .parse(rawTotals)
      return {
        logs: logs.map((log) => ({
          id: log.id,
          foodMasterId: log.food_master_id,
          nutritionVersionId: log.nutrition_version_id,
          quantity: Number(log.quantity),
        })),
        dailyTotals: totals.map((row) => ({
          date: row.date,
          nutrientCode: row.nutrient_code,
          value: Number(row.value),
        })),
      }
    }

    const before = await readSnapshot()
    const added = (
      await service.addNutritionVersion({
        foodMasterId: 'fm_version_product',
        changeKind: 'product_update',
        nutrition: { energy_kcal: 165, protein_g: 6 },
        source: 'web_search',
        sourceUrl: 'https://example.test/items/sample-pantry-item',
        isEstimated: false,
        servingBasis: '1 package (90 g)',
        netContent: '4 packages (360 g)',
        checkedOn: '2026-07-12',
        effectiveFrom: '2026-07-01',
      })
    )._unsafeUnwrap()
    const after = await readSnapshot()
    const versions = (
      await service.listNutritionVersions('fm_version_product')
    )._unsafeUnwrap()
    const versionLabels = new Map([
      [initialVersionId, 'version-1'],
      [added.id, 'version-2'],
    ])

    expect(
      observation({
        added: normalizeVersion(added, versionLabels),
        before,
        after,
        versions: versions.map((version) =>
          normalizeVersion(version, versionLabels),
        ),
      }),
    ).toEqual({
      added: {
        id: 'version-2',
        foodMasterId: 'fm_version_product',
        versionNo: 2,
        changeKind: 'product_update',
        correctsVersionId: null,
        isCurrent: true,
        servingBasis: '1 package (90 g)',
        netContent: '4 packages (360 g)',
        nutrition: { energy_kcal: 165, protein_g: 6 },
        source: 'web_search',
        sourceUrl: 'https://example.test/items/sample-pantry-item',
        sourceCompositionCode: null,
        isEstimated: false,
        checkedOn: '2026-07-12',
        effectiveFrom: '2026-07-01',
        reason: null,
        mealLogCount: 0,
      },
      before: {
        logs: [
          {
            id: 'ml_version_product',
            foodMasterId: 'fm_version_product',
            nutritionVersionId: initialVersionId,
            quantity: 1.5,
          },
        ],
        dailyTotals: [
          { date: '2026-07-11', nutrientCode: 'energy_kcal', value: 150 },
          { date: '2026-07-11', nutrientCode: 'protein_g', value: 7.5 },
        ],
      },
      after: {
        logs: [
          {
            id: 'ml_version_product',
            foodMasterId: 'fm_version_product',
            nutritionVersionId: initialVersionId,
            quantity: 1.5,
          },
        ],
        dailyTotals: [
          { date: '2026-07-11', nutrientCode: 'energy_kcal', value: 150 },
          { date: '2026-07-11', nutrientCode: 'protein_g', value: 7.5 },
        ],
      },
      versions: [
        {
          id: 'version-1',
          foodMasterId: 'fm_version_product',
          versionNo: 1,
          changeKind: 'initial',
          correctsVersionId: null,
          isCurrent: false,
          servingBasis: null,
          netContent: null,
          nutrition: { energy_kcal: 100, protein_g: 5 },
          source: 'user_input',
          sourceUrl: null,
          sourceCompositionCode: null,
          isEstimated: false,
          checkedOn: null,
          effectiveFrom: null,
          reason: null,
          mealLogCount: 1,
        },
        {
          id: 'version-2',
          foodMasterId: 'fm_version_product',
          versionNo: 2,
          changeKind: 'product_update',
          correctsVersionId: null,
          isCurrent: true,
          servingBasis: '1 package (90 g)',
          netContent: '4 packages (360 g)',
          nutrition: { energy_kcal: 165, protein_g: 6 },
          source: 'web_search',
          sourceUrl: 'https://example.test/items/sample-pantry-item',
          sourceCompositionCode: null,
          isEstimated: false,
          checkedOn: '2026-07-12',
          effectiveFrom: '2026-07-01',
          reason: null,
          mealLogCount: 0,
        },
      ],
    })
  })

  it('keeps old corrections historical and makes a correction current only when its target is current', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_version_correction',
      name: 'sample pantry grain',
    })
    const initialVersionId = await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_version_correction',
      versionNo: 1,
      isCurrent: true,
      changeKind: 'initial',
      source: 'user_input',
      isEstimated: false,
      servingBasis: '1 serving (25 g)',
      netContent: '2 servings (50 g)',
      effectiveFrom: '2026-06-01',
      nutrients: { energy_kcal: 110 },
    })
    await seedFoodComposition(tx, {
      code: 'composition_alpha',
      name: 'sample grain',
    })
    const service = createFoodMasterService(
      createFoodMasterRepository(tx, { wrapInTransaction: false }),
    )
    const updated = (
      await service.addNutritionVersion({
        foodMasterId: 'fm_version_correction',
        changeKind: 'product_update',
        nutrition: { energy_kcal: 130 },
        source: 'web_search',
        sourceUrl: 'https://example.test/items/sample-pantry-grain',
        isEstimated: false,
        servingBasis: '1 serving (30 g)',
        netContent: '2 servings (60 g)',
        checkedOn: '2026-07-12',
        effectiveFrom: '2026-07-01',
      })
    )._unsafeUnwrap()
    const oldCorrection = (
      await service.addNutritionVersion({
        foodMasterId: 'fm_version_correction',
        changeKind: 'correction',
        correctsVersionId: initialVersionId,
        reason: 'the original energy value was transcribed incorrectly',
        nutrition: { energy_kcal: 115 },
        source: 'composition_table_estimate',
        sourceCompositionCode: 'composition_alpha',
        isEstimated: true,
      })
    )._unsafeUnwrap()
    const currentCorrection = (
      await service.addNutritionVersion({
        foodMasterId: 'fm_version_correction',
        changeKind: 'correction',
        correctsVersionId: updated.id,
        reason: 'the package label was read incorrectly',
        nutrition: { energy_kcal: 125 },
        source: 'user_input',
        isEstimated: false,
      })
    )._unsafeUnwrap()
    const versions = (
      await service.listNutritionVersions('fm_version_correction')
    )._unsafeUnwrap()
    const versionLabels = new Map([
      [initialVersionId, 'version-1'],
      [updated.id, 'version-2'],
      [oldCorrection.id, 'version-3'],
      [currentCorrection.id, 'version-4'],
    ])

    expect(
      observation(
        versions.map((version) => normalizeVersion(version, versionLabels)),
      ),
    ).toEqual([
      {
        id: 'version-1',
        foodMasterId: 'fm_version_correction',
        versionNo: 1,
        changeKind: 'initial',
        correctsVersionId: null,
        isCurrent: false,
        servingBasis: '1 serving (25 g)',
        netContent: '2 servings (50 g)',
        nutrition: { energy_kcal: 110 },
        source: 'user_input',
        sourceUrl: null,
        sourceCompositionCode: null,
        isEstimated: false,
        checkedOn: null,
        effectiveFrom: '2026-06-01',
        reason: null,
        mealLogCount: 0,
      },
      {
        id: 'version-2',
        foodMasterId: 'fm_version_correction',
        versionNo: 2,
        changeKind: 'product_update',
        correctsVersionId: null,
        isCurrent: false,
        servingBasis: '1 serving (30 g)',
        netContent: '2 servings (60 g)',
        nutrition: { energy_kcal: 130 },
        source: 'web_search',
        sourceUrl: 'https://example.test/items/sample-pantry-grain',
        sourceCompositionCode: null,
        isEstimated: false,
        checkedOn: '2026-07-12',
        effectiveFrom: '2026-07-01',
        reason: null,
        mealLogCount: 0,
      },
      {
        id: 'version-3',
        foodMasterId: 'fm_version_correction',
        versionNo: 3,
        changeKind: 'correction',
        correctsVersionId: 'version-1',
        isCurrent: false,
        servingBasis: '1 serving (25 g)',
        netContent: '2 servings (50 g)',
        nutrition: { energy_kcal: 115 },
        source: 'composition_table_estimate',
        sourceUrl: null,
        sourceCompositionCode: 'composition_alpha',
        isEstimated: true,
        checkedOn: null,
        effectiveFrom: '2026-06-01',
        reason: 'the original energy value was transcribed incorrectly',
        mealLogCount: 0,
      },
      {
        id: 'version-4',
        foodMasterId: 'fm_version_correction',
        versionNo: 4,
        changeKind: 'correction',
        correctsVersionId: 'version-2',
        isCurrent: true,
        servingBasis: '1 serving (30 g)',
        netContent: '2 servings (60 g)',
        nutrition: { energy_kcal: 125 },
        source: 'user_input',
        sourceUrl: null,
        sourceCompositionCode: null,
        isEstimated: false,
        checkedOn: null,
        effectiveFrom: '2026-07-01',
        reason: 'the package label was read incorrectly',
        mealLogCount: 0,
      },
    ])
  })

  it('inherits omitted correction metadata and honors explicit replacements', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_version_metadata',
      name: 'sample pantry ingredient',
    })
    await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_version_metadata',
      versionNo: 1,
      isCurrent: true,
      changeKind: 'initial',
      source: 'user_input',
      isEstimated: false,
      nutrients: { energy_kcal: 70 },
    })
    const service = createFoodMasterService(
      createFoodMasterRepository(tx, { wrapInTransaction: false }),
    )
    const updated = (
      await service.addNutritionVersion({
        foodMasterId: 'fm_version_metadata',
        changeKind: 'product_update',
        nutrition: { energy_kcal: 80 },
        source: 'user_input',
        isEstimated: false,
        servingBasis: '1 serving (40 g)',
        netContent: '3 servings (120 g)',
        checkedOn: '2026-07-12',
        effectiveFrom: '2026-07-01',
      })
    )._unsafeUnwrap()
    const inherited = (
      await service.addNutritionVersion({
        foodMasterId: 'fm_version_metadata',
        changeKind: 'correction',
        correctsVersionId: updated.id,
        reason: 'synthetic correction reason',
        nutrition: { energy_kcal: 85 },
        source: 'user_input',
        isEstimated: false,
      })
    )._unsafeUnwrap()
    const overridden = (
      await service.addNutritionVersion({
        foodMasterId: 'fm_version_metadata',
        changeKind: 'correction',
        correctsVersionId: inherited.id,
        reason: 'synthetic correction reason',
        nutrition: { energy_kcal: 90 },
        source: 'user_input',
        isEstimated: false,
        servingBasis: '1 serving (45 g)',
        netContent: '3 servings (135 g)',
        effectiveFrom: null,
      })
    )._unsafeUnwrap()
    const versions = (
      await service.listNutritionVersions('fm_version_metadata')
    )._unsafeUnwrap()
    const versionLabels = new Map([
      [updated.id, 'version-2'],
      [inherited.id, 'version-3'],
      [overridden.id, 'version-4'],
    ])

    expect(
      observation(
        versions.map((version) => ({
          id: versionLabels.get(version.id) ?? 'version-1',
          versionNo: version.versionNo,
          isCurrent: version.isCurrent,
          servingBasis: version.servingBasis,
          netContent: version.netContent,
          effectiveFrom: version.effectiveFrom,
        })),
      ),
    ).toEqual([
      {
        id: 'version-1',
        versionNo: 1,
        isCurrent: false,
        servingBasis: null,
        netContent: null,
        effectiveFrom: null,
      },
      {
        id: 'version-2',
        versionNo: 2,
        isCurrent: false,
        servingBasis: '1 serving (40 g)',
        netContent: '3 servings (120 g)',
        effectiveFrom: '2026-07-01',
      },
      {
        id: 'version-3',
        versionNo: 3,
        isCurrent: false,
        servingBasis: '1 serving (40 g)',
        netContent: '3 servings (120 g)',
        effectiveFrom: '2026-07-01',
      },
      {
        id: 'version-4',
        versionNo: 4,
        isCurrent: true,
        servingBasis: '1 serving (45 g)',
        netContent: '3 servings (135 g)',
        effectiveFrom: null,
      },
    ])
  })

  it('returns food_master_not_found when listing a missing food', async () => {
    const tx = getTx()
    const service = createFoodMasterService(
      createFoodMasterRepository(tx, { wrapInTransaction: false }),
    )
    const result = await service.listNutritionVersions('fm_version_missing')

    expect(
      observation(
        result.match(
          () => ({
            code: 'unexpected_success',
            message: 'listing a missing food unexpectedly succeeded',
            details: {},
          }),
          (error) => ({
            code: error.code,
            message: error.message,
            details: error.details,
          }),
        ),
      ),
    ).toEqual({
      code: 'food_master_not_found',
      message: 'food_master not found: fm_version_missing',
      details: { foodMasterId: 'fm_version_missing' },
    })
  })

  it('returns unknown_nutrient_code when adding an unregistered nutrient', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_version_unknown_nutrient',
      name: 'sample pantry ingredient',
    })
    await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_version_unknown_nutrient',
      versionNo: 1,
      isCurrent: true,
      changeKind: 'initial',
      source: 'user_input',
      isEstimated: false,
      nutrients: { energy_kcal: 70 },
    })
    const service = createFoodMasterService(
      createFoodMasterRepository(tx, { wrapInTransaction: false }),
    )
    const result = await service.addNutritionVersion({
      foodMasterId: 'fm_version_unknown_nutrient',
      changeKind: 'product_update',
      nutrition: { energy_kcal: 75, unregistered_nutrient: 1 },
      source: 'user_input',
      isEstimated: false,
      checkedOn: '2026-07-12',
    })

    expect(
      observation(
        result.match(
          () => ({
            code: 'unexpected_success',
            message: 'adding an unregistered nutrient unexpectedly succeeded',
            details: {},
          }),
          (error) => ({
            code: error.code,
            message: error.message,
            details: error.details,
          }),
        ),
      ),
    ).toEqual({
      code: 'unknown_nutrient_code',
      message:
        'nutrient_code not registered in nutrient_definitions: unregistered_nutrient',
      details: { unknown: ['unregistered_nutrient'] },
    })
  })

  it('rejects evidence that does not satisfy the source rules', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_version_primary',
      name: 'sample pantry pulse',
    })
    const primaryVersionId = await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_version_primary',
      versionNo: 1,
      isCurrent: true,
      changeKind: 'initial',
      source: 'user_input',
      isEstimated: false,
      nutrients: { energy_kcal: 90 },
    })
    const service = createFoodMasterService(
      createFoodMasterRepository(tx, { wrapInTransaction: false }),
    )
    const missingEvidence = await service.addNutritionVersion({
      foodMasterId: 'fm_version_primary',
      changeKind: 'product_update',
      nutrition: { energy_kcal: 95 },
      source: 'web_search',
      isEstimated: false,
      checkedOn: '2026-07-12',
    })
    const versions = (
      await service.listNutritionVersions('fm_version_primary')
    )._unsafeUnwrap()

    expect(
      observation({
        missingEvidence: missingEvidence.match(
          () => null,
          (error) => ({ code: error.code, details: error.details }),
        ),
        versions: versions.map((version) => ({
          id:
            version.id === primaryVersionId ? 'version-1' : '<unknown-version>',
          versionNo: version.versionNo,
          isCurrent: version.isCurrent,
          nutrition: version.nutrition,
        })),
      }),
    ).toEqual({
      missingEvidence: {
        code: 'missing_source_url',
        details: {
          source: 'web_search',
          sourceUrl: null,
          sourceCompositionCode: null,
        },
      },
      versions: [
        {
          id: 'version-1',
          versionNo: 1,
          isCurrent: true,
          nutrition: { energy_kcal: 90 },
        },
      ],
    })
  })

  it('rejects a correction that refers to another food', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_version_primary',
      name: 'sample pantry pulse',
    })
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_version_other',
      name: 'sample pantry seed',
    })
    const primaryVersionId = await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_version_primary',
      versionNo: 1,
      isCurrent: true,
      changeKind: 'initial',
      source: 'user_input',
      isEstimated: false,
      nutrients: { energy_kcal: 90 },
    })
    const otherVersionId = await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_version_other',
      versionNo: 1,
      isCurrent: true,
      changeKind: 'initial',
      source: 'user_input',
      isEstimated: false,
      nutrients: { energy_kcal: 80 },
    })
    const service = createFoodMasterService(
      createFoodMasterRepository(tx, { wrapInTransaction: false }),
    )
    const wrongFoodCorrection = await service.addNutritionVersion({
      foodMasterId: 'fm_version_primary',
      changeKind: 'correction',
      correctsVersionId: otherVersionId,
      reason: 'correction must refer to a version on this food',
      nutrition: { energy_kcal: 95 },
      source: 'user_input',
      isEstimated: false,
    })
    const versions = (
      await service.listNutritionVersions('fm_version_primary')
    )._unsafeUnwrap()

    expect(
      observation({
        error: wrongFoodCorrection.match(
          () => null,
          (error) => ({ code: error.code, details: error.details }),
        ),
        versions: versions.map((version) => ({
          id:
            version.id === primaryVersionId ? 'version-1' : '<unknown-version>',
          versionNo: version.versionNo,
          isCurrent: version.isCurrent,
          nutrition: version.nutrition,
        })),
      }),
    ).toEqual({
      error: {
        code: 'nutrition_version_not_found',
        details: {
          foodMasterId: 'fm_version_primary',
          nutritionVersionId: otherVersionId,
        },
      },
      versions: [
        {
          id: 'version-1',
          versionNo: 1,
          isCurrent: true,
          nutrition: { energy_kcal: 90 },
        },
      ],
    })
  })

  it('rejects a nutrition version when the food has no nutrition history', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_version_empty',
      name: 'sample pantry flour',
    })
    await seedNutrientDefinition(tx, {
      code: 'energy_kcal',
      displayName: 'energy',
      unit: 'kcal',
    })
    const service = createFoodMasterService(
      createFoodMasterRepository(tx, { wrapInTransaction: false }),
    )
    const addResult = await service.addNutritionVersion({
      foodMasterId: 'fm_version_empty',
      changeKind: 'product_update',
      nutrition: { energy_kcal: 105 },
      source: 'user_input',
      isEstimated: false,
      checkedOn: '2026-07-12',
    })
    const versions = (
      await service.listNutritionVersions('fm_version_empty')
    )._unsafeUnwrap()

    expect(
      observation({
        error: addResult.match(
          () => null,
          (error) => ({ code: error.code, details: error.details }),
        ),
        versions,
      }),
    ).toEqual({
      error: {
        code: 'nutrition_version_required',
        details: { foodMasterId: 'fm_version_empty' },
      },
      versions: [],
    })
  })
})
