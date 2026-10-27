import { beforeEach, expect, it } from 'vitest'

import { createFoodMasterRepository } from '#domain/food-master/index'
import type { FoodMasterRepository } from '#domain/food-master/repository'
import { createMealHistoryService } from '#domain/meal-history/mealHistoryService'
import { captureDomainError } from '#test/capture-domain-error'
import { describeIfDb, setupTx } from '#test/db'
import { createCountingIdGenerator, type IdCounter } from '#test/id-counter'
import { jstDate } from '#test/jst-date'
import {
  seedDelivery,
  seedFoodMaster,
  seedFoodMasterAlias,
  seedFoodMasterNutritionVersion,
  seedFoodMasterWithoutNutrition,
  seedMealLog,
  seedMealSet,
  seedMealSetItem,
  seedStockItem,
  seedStockLot,
  seedStockMovement,
  seedStorageLocation,
} from '#test/seed'

const observation = <T extends object>(value: T): T => value

describeIfDb('mergeFoodMasters (merge-repository)', () => {
  const getTx = setupTx()
  let repo: FoodMasterRepository

  beforeEach(() => {
    const tx = getTx()
    let n = 0
    const idCounter: IdCounter = {
      next: () => {
        n += 1
        return n
      },
    }
    // The outer per-test transaction already provides atomicity, and
    // postgres-js rejects a nested BEGIN inside it.
    repo = createFoodMasterRepository(tx, {
      generateId: createCountingIdGenerator(idCounter),
      wrapInTransaction: false,
    })
  })

  // The loser also appears in one meal set, with no alias conflicts in the pair.
  const seedBasicPair = async (): Promise<void> => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_survivor',
      name: 'survivor food',
      source: 'web_search',
      sourceUrl: 'https://example.test/survivor',
      nutrients: { energy_kcal: 100 },
    })
    await seedFoodMaster(tx, {
      id: 'fm_loser',
      name: 'loser food',
      source: 'user_input',
      nutrients: { energy_kcal: 50, protein_g: 5 },
    })
    await seedFoodMasterAlias(tx, {
      id: 'fma_survivor_alias',
      foodMasterId: 'fm_survivor',
      alias: 'survivor alias',
    })
    await seedFoodMasterAlias(tx, {
      id: 'fma_loser_alias',
      foodMasterId: 'fm_loser',
      alias: 'loser alias',
    })
    await seedMealLog(tx, {
      id: 'ml_survivor',
      foodMasterId: 'fm_survivor',
      eatenDate: jstDate('2026-06-01'),
      mealType: 'breakfast',
      quantity: 100,
    })
    await seedMealLog(tx, {
      id: 'ml_loser',
      foodMasterId: 'fm_loser',
      eatenDate: jstDate('2026-06-02'),
      mealType: 'lunch',
      quantity: 80,
    })
    await seedMealSet(tx, { id: 'ms_common_pair', name: 'common pair' })
    await seedMealSetItem(tx, {
      mealSetId: 'ms_common_pair',
      foodMasterId: 'fm_loser',
      quantity: 1.5,
    })
  }

  interface DbSnapshot {
    readonly foodMasters: ReadonlyArray<{ id: string; name: string }>
    readonly nutritionSources: ReadonlyArray<{
      foodMasterId: string
      isEstimated: boolean
      source: string
      sourceUrl: string | null
      sourceCompositionCode: string | null
    }>
    readonly aliases: ReadonlyArray<{ foodMasterId: string; alias: string }>
    readonly nutrients: ReadonlyArray<{
      foodMasterId: string
      nutrientCode: string
    }>
    readonly mealLogs: ReadonlyArray<{
      id: string
      foodMasterId: string
      nutritionVersionOrigin: string
      referencesCurrentVersion: boolean
    }>
    readonly stockItems: ReadonlyArray<{
      foodMasterId: string
      storageLocationId: string | null
      eatWithinDays: number | null
    }>
    readonly storageLocations: ReadonlyArray<{
      id: string
      name: string
      capacity: string | null
    }>
    readonly stockLots: ReadonlyArray<{
      id: string
      foodMasterId: string
      quantity: string
      receivedDate: string | null
      bestBefore: string | null
      eatBy: string | null
    }>
    readonly stockMovements: ReadonlyArray<{
      id: string
      stockLotId: string
      delta: string
      reason: string
    }>
    readonly mealSets: ReadonlyArray<{ id: string; name: string }>
    readonly mealSetItems: ReadonlyArray<{
      mealSetId: string
      foodMasterId: string
      quantity: number
    }>
  }

  const snapshot = async (): Promise<DbSnapshot> => {
    const tx = getTx()
    const [
      foodMasters,
      nutritionSources,
      aliases,
      nutrients,
      mealLogs,
      stockItems,
      storageLocations,
      stockLots,
      stockMovements,
      mealSets,
      mealSetItems,
    ] = await Promise.all([
      tx<{ id: string; name: string }[]>`
        SELECT id, name FROM food_masters ORDER BY id
      `,
      tx<
        {
          food_master_id: string
          is_estimated: boolean
          source: string
          source_url: string | null
          source_composition_code: string | null
        }[]
      >`
        SELECT food_master_id, is_estimated, source, source_url,
               source_composition_code
        FROM food_master_nutrition
        WHERE is_current = true
        ORDER BY food_master_id
      `,
      tx<{ food_master_id: string; alias: string }[]>`
        SELECT food_master_id, alias FROM food_master_aliases ORDER BY alias
      `,
      tx<{ food_master_id: string; nutrient_code: string }[]>`
        SELECT nutrition.food_master_id, nutrients.nutrient_code
        FROM food_master_nutrients AS nutrients
        JOIN food_master_nutrition AS nutrition
          ON nutrition.id = nutrients.nutrition_version_id
        WHERE nutrition.is_current = true
        ORDER BY nutrition.food_master_id, nutrients.nutrient_code
      `,
      tx<
        {
          id: string
          food_master_id: string
          nutrition_version_origin: string
          references_current_version: boolean
        }[]
      >`
        SELECT logs.id, logs.food_master_id,
               logs.nutrition_version_origin,
               logs.nutrition_version_id = current.id
                 AS references_current_version
        FROM meal_logs AS logs
        LEFT JOIN food_master_nutrition AS current
          ON current.food_master_id = logs.food_master_id
         AND current.is_current = true
        ORDER BY logs.id
      `,
      tx<
        {
          food_master_id: string
          storage_location_id: string | null
          eat_within_days: number | null
        }[]
      >`
        SELECT food_master_id, storage_location_id, eat_within_days
        FROM stock_items ORDER BY food_master_id
      `,
      tx<{ id: string; name: string; capacity: string | null }[]>`
        SELECT id, name, capacity::text AS capacity
        FROM storage_locations ORDER BY id
      `,
      tx<
        {
          id: string
          food_master_id: string
          quantity: string
          received_date: string | null
          best_before: string | null
          eat_by: string | null
        }[]
      >`
        SELECT id, food_master_id, quantity::text AS quantity,
               received_date::text AS received_date,
               best_before::text AS best_before, eat_by::text AS eat_by
        FROM stock_lots ORDER BY id
      `,
      tx<
        {
          id: string
          stock_lot_id: string
          delta: string
          reason: string
        }[]
      >`
        SELECT id, stock_lot_id, delta::text AS delta, reason
        FROM stock_movements ORDER BY id
      `,
      tx<{ id: string; name: string }[]>`
        SELECT id, name FROM meal_sets ORDER BY id
      `,
      tx<{ meal_set_id: string; food_master_id: string; quantity: string }[]>`
        SELECT meal_set_id, food_master_id, quantity
        FROM meal_set_items ORDER BY meal_set_id, food_master_id
      `,
    ])
    return {
      foodMasters,
      nutritionSources: nutritionSources.map((r) => ({
        foodMasterId: r.food_master_id,
        isEstimated: r.is_estimated,
        source: r.source,
        sourceUrl: r.source_url,
        sourceCompositionCode: r.source_composition_code,
      })),
      aliases: aliases.map((r) => ({
        foodMasterId: r.food_master_id,
        alias: r.alias,
      })),
      nutrients: nutrients.map((r) => ({
        foodMasterId: r.food_master_id,
        nutrientCode: r.nutrient_code,
      })),
      mealLogs: mealLogs.map((r) => ({
        id: r.id,
        foodMasterId: r.food_master_id,
        nutritionVersionOrigin: r.nutrition_version_origin,
        referencesCurrentVersion: r.references_current_version,
      })),
      stockItems: stockItems.map((r) => ({
        foodMasterId: r.food_master_id,
        storageLocationId: r.storage_location_id,
        eatWithinDays: r.eat_within_days,
      })),
      storageLocations: storageLocations.map((r) => ({
        id: r.id,
        name: r.name,
        capacity: r.capacity,
      })),
      stockLots: stockLots.map((r) => ({
        id: r.id,
        foodMasterId: r.food_master_id,
        quantity: r.quantity,
        receivedDate: r.received_date,
        bestBefore: r.best_before,
        eatBy: r.eat_by,
      })),
      stockMovements: stockMovements.map((r) => ({
        id: r.id,
        stockLotId: r.stock_lot_id,
        delta: r.delta,
        reason: r.reason,
      })),
      mealSets,
      mealSetItems: mealSetItems.map((r) => ({
        mealSetId: r.meal_set_id,
        foodMasterId: r.food_master_id,
        quantity: Number(r.quantity),
      })),
    }
  }

  it('previews a merge without writing anything (dry_run=true)', async () => {
    await seedBasicPair()
    const before = await snapshot()

    const result = (
      await repo.merge('fm_survivor', 'fm_loser', true)
    )._unsafeUnwrap()

    expect(result).toEqual({
      survivorId: 'fm_survivor',
      loserId: 'fm_loser',
      applied: false,
      movedAliases: ['loser alias'],
      nameMovedAsAlias: 'loser food',
      movedNutritionVersions: [{ previousVersionNo: 1, versionNo: 2 }],
      movedMealLogCount: 1,
    })

    expect(await snapshot()).toEqual(before)
  })

  it('returns the merge result when a merge is applied', async () => {
    await seedBasicPair()

    const result = (
      await repo.merge('fm_survivor', 'fm_loser', false)
    )._unsafeUnwrap()

    expect(result).toEqual({
      survivorId: 'fm_survivor',
      loserId: 'fm_loser',
      applied: true,
      movedAliases: ['loser alias'],
      nameMovedAsAlias: 'loser food',
      movedNutritionVersions: [{ previousVersionNo: 1, versionNo: 2 }],
      movedMealLogCount: 1,
    })
  })

  it('moves food references to the survivor in logs and meal sets', async () => {
    await seedBasicPair()

    ;(await repo.merge('fm_survivor', 'fm_loser', false))._unsafeUnwrap()

    expect(await snapshot()).toEqual({
      foodMasters: [{ id: 'fm_survivor', name: 'survivor food' }],
      nutritionSources: [
        {
          foodMasterId: 'fm_survivor',
          isEstimated: false,
          source: 'web_search',
          sourceUrl: 'https://example.test/survivor',
          sourceCompositionCode: null,
        },
      ],
      aliases: [
        { foodMasterId: 'fm_survivor', alias: 'loser alias' },
        { foodMasterId: 'fm_survivor', alias: 'loser food' },
        { foodMasterId: 'fm_survivor', alias: 'survivor alias' },
      ],
      // The loser's nutrients remain in its moved, non-current version.
      nutrients: [{ foodMasterId: 'fm_survivor', nutrientCode: 'energy_kcal' }],
      mealLogs: [
        {
          id: 'ml_loser',
          foodMasterId: 'fm_survivor',
          nutritionVersionOrigin: 'recorded',
          referencesCurrentVersion: false,
        },
        {
          id: 'ml_survivor',
          foodMasterId: 'fm_survivor',
          nutritionVersionOrigin: 'recorded',
          referencesCurrentVersion: true,
        },
      ],
      mealSets: [{ id: 'ms_common_pair', name: 'common pair' }],
      mealSetItems: [
        {
          mealSetId: 'ms_common_pair',
          foodMasterId: 'fm_survivor',
          quantity: 1.5,
        },
      ],
      stockItems: [],
      storageLocations: [],
      stockLots: [],
      stockMovements: [],
    })
  })

  it('keeps daily aggregates and every referenced version when merging multiple versions', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_merge_survivor',
      name: 'survivor food',
    })
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_merge_loser',
      name: 'loser food',
    })
    const survivorOldVersionId = await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_merge_survivor',
      versionNo: 1,
      isCurrent: false,
      changeKind: 'initial',
      source: 'user_input',
      nutrients: { energy_kcal: 100 },
    })
    const survivorCurrentVersionId = await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_merge_survivor',
      versionNo: 2,
      isCurrent: true,
      changeKind: 'product_update',
      source: 'user_input',
      nutrients: { energy_kcal: 120 },
    })
    const loserOldVersionId = await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_merge_loser',
      versionNo: 1,
      isCurrent: false,
      changeKind: 'initial',
      source: 'user_input',
      nutrients: { energy_kcal: 50 },
    })
    const loserCurrentVersionId = await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_merge_loser',
      versionNo: 2,
      isCurrent: true,
      changeKind: 'correction',
      correctsVersionId: loserOldVersionId,
      reason: 'corrected source value',
      source: 'user_input',
      nutrients: { energy_kcal: 60 },
    })
    for (const mealLog of [
      {
        id: 'ml_survivor_old',
        foodMasterId: 'fm_merge_survivor',
        nutritionVersionId: survivorOldVersionId,
        eatenDate: jstDate('2026-06-01'),
        quantity: 1,
      },
      {
        id: 'ml_survivor_current',
        foodMasterId: 'fm_merge_survivor',
        nutritionVersionId: survivorCurrentVersionId,
        eatenDate: jstDate('2026-06-02'),
        quantity: 2,
      },
      {
        id: 'ml_loser_old',
        foodMasterId: 'fm_merge_loser',
        nutritionVersionId: loserOldVersionId,
        eatenDate: jstDate('2026-06-01'),
        quantity: 3,
      },
      {
        id: 'ml_loser_current',
        foodMasterId: 'fm_merge_loser',
        nutritionVersionId: loserCurrentVersionId,
        eatenDate: jstDate('2026-06-02'),
        quantity: 4,
      },
    ] as const) {
      await seedMealLog(tx, {
        ...mealLog,
        mealType: 'lunch',
        nutritionVersionOrigin: 'migrated',
      })
    }

    const historyService = createMealHistoryService(tx)
    const readAggregate = async () => {
      const result = (
        await historyService.query({
          periodFrom: jstDate('2026-06-01'),
          periodTo: jstDate('2026-06-03'),
          nutrientCodes: ['energy_kcal'],
        })
      )._unsafeUnwrap()
      return {
        totals: result.totals,
        incompleteNutrients: result.incompleteNutrients,
        perDay: result.perDay,
        hasEstimatedValues: result.hasEstimatedValues,
        hasUnknownValues: result.hasUnknownValues,
      }
    }
    const before = await readAggregate()

    ;(
      await repo.merge('fm_merge_survivor', 'fm_merge_loser', false)
    )._unsafeUnwrap()

    const after = await readAggregate()
    const versionRows = await tx<
      {
        version_no: number
        is_current: boolean
        change_kind: string
        corrects_previous_version: boolean
        energy_kcal: number
      }[]
    >`
      SELECT nutrition.version_no, nutrition.is_current,
             nutrition.change_kind,
             COALESCE(
               nutrition.corrects_version_id = (
                 SELECT previous.id
                 FROM food_master_nutrition AS previous
                 WHERE previous.food_master_id = nutrition.food_master_id
                   AND previous.version_no = nutrition.version_no - 1
               ),
               false
             ) AS corrects_previous_version,
             nutrients.value::float8 AS energy_kcal
      FROM food_master_nutrition AS nutrition
      JOIN food_master_nutrients AS nutrients
        ON nutrients.nutrition_version_id = nutrition.id
       AND nutrients.nutrient_code = 'energy_kcal'
      WHERE nutrition.food_master_id = 'fm_merge_survivor'
      ORDER BY nutrition.version_no
    `
    const mealLogRows = await tx<
      {
        id: string
        food_master_id: string
        version_no: number
        version_is_current: boolean
        nutrition_version_origin: string
      }[]
    >`
      SELECT logs.id, logs.food_master_id, nutrition.version_no,
             nutrition.is_current AS version_is_current,
             logs.nutrition_version_origin
      FROM meal_logs AS logs
      JOIN food_master_nutrition AS nutrition
        ON nutrition.id = logs.nutrition_version_id
      WHERE logs.id IN (
        'ml_survivor_old', 'ml_survivor_current', 'ml_loser_old',
        'ml_loser_current'
      )
      ORDER BY logs.id
    `

    const expectedAggregate = {
      totals: { energy_kcal: 730 },
      incompleteNutrients: [],
      perDay: [
        {
          date: '2026-06-01',
          totals: { energy_kcal: 250 },
          incompleteNutrients: [],
          hasUnknownValues: false,
        },
        {
          date: '2026-06-02',
          totals: { energy_kcal: 480 },
          incompleteNutrients: [],
          hasUnknownValues: false,
        },
      ],
      hasEstimatedValues: false,
      hasUnknownValues: false,
    }
    const expectedResult = {
      before: expectedAggregate,
      after: expectedAggregate,
      versionRows: [
        {
          version_no: 1,
          is_current: false,
          change_kind: 'initial',
          corrects_previous_version: false,
          energy_kcal: 100,
        },
        {
          version_no: 2,
          is_current: true,
          change_kind: 'product_update',
          corrects_previous_version: false,
          energy_kcal: 120,
        },
        {
          version_no: 3,
          is_current: false,
          change_kind: 'initial',
          corrects_previous_version: false,
          energy_kcal: 50,
        },
        {
          version_no: 4,
          is_current: false,
          change_kind: 'correction',
          corrects_previous_version: true,
          energy_kcal: 60,
        },
      ],
      mealLogRows: [
        {
          id: 'ml_loser_current',
          food_master_id: 'fm_merge_survivor',
          version_no: 4,
          version_is_current: false,
          nutrition_version_origin: 'migrated',
        },
        {
          id: 'ml_loser_old',
          food_master_id: 'fm_merge_survivor',
          version_no: 3,
          version_is_current: false,
          nutrition_version_origin: 'migrated',
        },
        {
          id: 'ml_survivor_current',
          food_master_id: 'fm_merge_survivor',
          version_no: 2,
          version_is_current: true,
          nutrition_version_origin: 'migrated',
        },
        {
          id: 'ml_survivor_old',
          food_master_id: 'fm_merge_survivor',
          version_no: 1,
          version_is_current: false,
          nutrition_version_origin: 'migrated',
        },
      ],
    }
    expect(observation({ before, after, versionRows, mealLogRows })).toEqual(
      expectedResult,
    )
  })

  it('preserves loser nutrition when the survivor has no current version', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_survivor_unknown',
      name: 'Unknown nutrition survivor',
    })
    await seedFoodMaster(tx, {
      id: 'fm_loser_known',
      name: 'Known nutrition loser',
      source: 'user_input',
      nutrients: { energy_kcal: 100 },
    })
    await seedMealLog(tx, {
      id: 'ml_loser_known',
      foodMasterId: 'fm_loser_known',
      eatenDate: jstDate('2026-06-03'),
      mealType: 'dinner',
      quantity: 1.5,
    })

    ;(
      await repo.merge('fm_survivor_unknown', 'fm_loser_known', false)
    )._unsafeUnwrap()

    const rows = await tx<
      {
        id: string
        food_master_id: string
        nutrition_version_origin: string
        nutrition_version_no: number | null
        version_is_current: boolean | null
        nutrition_change_count: number
      }[]
    >`
      SELECT logs.id, logs.food_master_id, logs.nutrition_version_origin,
             nutrition.version_no AS nutrition_version_no,
             nutrition.is_current AS version_is_current,
             (SELECT count(*)::int FROM meal_log_nutrition_changes AS changes
              WHERE changes.meal_log_id = logs.id) AS nutrition_change_count
      FROM meal_logs AS logs
      LEFT JOIN food_master_nutrition AS nutrition
        ON nutrition.id = logs.nutrition_version_id
      WHERE logs.id = 'ml_loser_known'
    `

    expect(rows).toEqual([
      {
        id: 'ml_loser_known',
        food_master_id: 'fm_survivor_unknown',
        nutrition_version_origin: 'recorded',
        nutrition_version_no: 1,
        version_is_current: false,
        nutrition_change_count: 0,
      },
    ])
  })

  const snapshotStock = async (): Promise<{
    readonly stockItems: DbSnapshot['stockItems']
    readonly storageLocations: DbSnapshot['storageLocations']
    readonly stockLots: DbSnapshot['stockLots']
    readonly stockMovements: DbSnapshot['stockMovements']
  }> => {
    const result = await snapshot()
    return {
      stockItems: result.stockItems,
      storageLocations: result.storageLocations,
      stockLots: result.stockLots,
      stockMovements: result.stockMovements,
    }
  }

  it('moves stock items and lots from the loser when the survivor has no stock item', async () => {
    await seedBasicPair()
    const tx = getTx()
    await seedStorageLocation(tx, {
      id: 'sl_loser',
      name: 'Sample compartment',
      capacity: 6,
    })
    await seedStockItem(tx, {
      foodMasterId: 'fm_loser',
      storageLocationId: 'sl_loser',
      eatWithinDays: 18,
    })
    await seedStockLot(tx, {
      id: 'stl_loser',
      foodMasterId: 'fm_loser',
      quantity: 4.25,
      receivedDate: '2026-10-01',
      bestBefore: '2026-11-01',
      eatBy: '2026-10-19',
    })
    await seedStockMovement(tx, {
      id: 'stm_loser',
      stockLotId: 'stl_loser',
      delta: 4.25,
      reason: 'count',
    })

    const mergeResult = await repo.merge('fm_survivor', 'fm_loser', false)
    mergeResult._unsafeUnwrap()

    expect(await snapshotStock()).toEqual({
      stockItems: [
        {
          foodMasterId: 'fm_survivor',
          storageLocationId: 'sl_loser',
          eatWithinDays: 18,
        },
      ],
      storageLocations: [
        { id: 'sl_loser', name: 'Sample compartment', capacity: '6' },
      ],
      stockLots: [
        {
          id: 'stl_loser',
          foodMasterId: 'fm_survivor',
          quantity: '4.25',
          receivedDate: '2026-10-01',
          bestBefore: '2026-11-01',
          eatBy: '2026-10-19',
        },
      ],
      stockMovements: [
        {
          id: 'stm_loser',
          stockLotId: 'stl_loser',
          delta: '4.25',
          reason: 'count',
        },
      ],
    })
  })

  it('keeps the survivor stock item settings when both foods have stock items', async () => {
    await seedBasicPair()
    const tx = getTx()
    await seedStorageLocation(tx, {
      id: 'sl_survivor',
      name: 'Sample shelf',
      capacity: 12,
    })
    await seedStorageLocation(tx, {
      id: 'sl_loser',
      name: 'Sample drawer',
      capacity: 5,
    })
    await seedStockItem(tx, {
      foodMasterId: 'fm_survivor',
      storageLocationId: 'sl_survivor',
      eatWithinDays: 30,
    })
    await seedStockItem(tx, {
      foodMasterId: 'fm_loser',
      storageLocationId: 'sl_loser',
      eatWithinDays: 10,
    })
    await seedStockLot(tx, {
      id: 'stl_loser',
      foodMasterId: 'fm_loser',
      quantity: 2,
    })
    await seedStockMovement(tx, {
      id: 'stm_loser',
      stockLotId: 'stl_loser',
      delta: 2,
      reason: 'count',
    })

    const mergeResult = await repo.merge('fm_survivor', 'fm_loser', false)
    mergeResult._unsafeUnwrap()

    expect(await snapshotStock()).toEqual({
      stockItems: [
        {
          foodMasterId: 'fm_survivor',
          storageLocationId: 'sl_survivor',
          eatWithinDays: 30,
        },
      ],
      storageLocations: [
        { id: 'sl_loser', name: 'Sample drawer', capacity: '5' },
        { id: 'sl_survivor', name: 'Sample shelf', capacity: '12' },
      ],
      stockLots: [
        {
          id: 'stl_loser',
          foodMasterId: 'fm_survivor',
          quantity: '2',
          receivedDate: null,
          bestBefore: null,
          eatBy: null,
        },
      ],
      stockMovements: [
        {
          id: 'stm_loser',
          stockLotId: 'stl_loser',
          delta: '2',
          reason: 'count',
        },
      ],
    })
  })

  it('sums quantities when both foods are included in the same meal set', async () => {
    await seedBasicPair()
    const tx = getTx()
    await seedMealSetItem(tx, {
      mealSetId: 'ms_common_pair',
      foodMasterId: 'fm_survivor',
      quantity: 2.25,
    })

    ;(await repo.merge('fm_survivor', 'fm_loser', false))._unsafeUnwrap()

    const rows = await tx<
      { meal_set_id: string; food_master_id: string; quantity: number }[]
    >`
      SELECT meal_set_id, food_master_id, quantity::float8 AS quantity
      FROM meal_set_items
      WHERE meal_set_id = 'ms_common_pair'
      ORDER BY food_master_id
    `
    expect(rows).toEqual([
      {
        meal_set_id: 'ms_common_pair',
        food_master_id: 'fm_survivor',
        quantity: 3.75,
      },
    ])
  })

  it('combines stock lots when both foods are in the same delivery', async () => {
    await seedBasicPair()
    const tx = getTx()
    await seedStockItem(tx, { foodMasterId: 'fm_survivor' })
    await seedStockItem(tx, { foodMasterId: 'fm_loser' })
    await seedDelivery(tx, {
      id: 'dly_food_merge',
      sourceRef: 'sample-food-merge-order',
      status: 'received',
      expectedDate: '2026-10-20',
      receivedDate: '2026-10-21',
    })
    await seedStockLot(tx, {
      id: 'stl_delivery_survivor',
      foodMasterId: 'fm_survivor',
      deliveryId: 'dly_food_merge',
      quantity: 3,
      receivedDate: '2026-10-21',
      bestBefore: '2026-11-05',
      eatBy: '2026-10-31',
    })
    await seedStockLot(tx, {
      id: 'stl_delivery_loser',
      foodMasterId: 'fm_loser',
      deliveryId: 'dly_food_merge',
      quantity: 2,
      receivedDate: '2026-10-21',
      bestBefore: '2026-11-01',
      eatBy: '2026-10-29',
    })
    await seedStockMovement(tx, {
      id: 'stm_delivery_survivor',
      stockLotId: 'stl_delivery_survivor',
      delta: 3,
      reason: 'receive',
    })
    await seedStockMovement(tx, {
      id: 'stm_delivery_loser',
      stockLotId: 'stl_delivery_loser',
      delta: 2,
      reason: 'receive',
    })

    ;(await repo.merge('fm_survivor', 'fm_loser', false))._unsafeUnwrap()

    const result = await (async () => {
      const lots = await tx<
        {
          id: string
          food_master_id: string
          delivery_id: string | null
          quantity: string
          received_date: string | null
          best_before: string | null
          eat_by: string | null
        }[]
      >`
        SELECT id, food_master_id, delivery_id, quantity::text AS quantity,
               received_date::text AS received_date,
               best_before::text AS best_before, eat_by::text AS eat_by
        FROM stock_lots
        WHERE delivery_id = 'dly_food_merge'
      `
      const movements = await tx<
        { id: string; stock_lot_id: string; delta: string; reason: string }[]
      >`
        SELECT id, stock_lot_id, delta::text AS delta, reason
        FROM stock_movements
        WHERE id IN ('stm_delivery_survivor', 'stm_delivery_loser')
        ORDER BY id
      `
      return { lots, movements }
    })()

    expect(result).toEqual({
      lots: [
        {
          id: 'stl_delivery_survivor',
          food_master_id: 'fm_survivor',
          delivery_id: 'dly_food_merge',
          quantity: '5',
          received_date: '2026-10-21',
          best_before: '2026-11-01',
          eat_by: '2026-10-29',
        },
      ],
      movements: [
        {
          id: 'stm_delivery_loser',
          stock_lot_id: 'stl_delivery_survivor',
          delta: '2',
          reason: 'receive',
        },
        {
          id: 'stm_delivery_survivor',
          stock_lot_id: 'stl_delivery_survivor',
          delta: '3',
          reason: 'receive',
        },
      ],
    })
  })

  it('combines planned delivery lots when foods are merged', async () => {
    await seedBasicPair()
    const tx = getTx()
    await seedStockItem(tx, { foodMasterId: 'fm_survivor' })
    await seedStockItem(tx, { foodMasterId: 'fm_loser' })
    await seedDelivery(tx, {
      id: 'dly_planned_food_merge',
      sourceRef: 'sample-planned-food-merge-order',
      status: 'planned',
      expectedDate: '2026-10-20',
    })
    await seedStockLot(tx, {
      id: 'stl_planned_survivor',
      foodMasterId: 'fm_survivor',
      deliveryId: 'dly_planned_food_merge',
      quantity: 3,
    })
    await seedStockLot(tx, {
      id: 'stl_planned_loser',
      foodMasterId: 'fm_loser',
      deliveryId: 'dly_planned_food_merge',
      quantity: 2,
    })

    ;(await repo.merge('fm_survivor', 'fm_loser', false))._unsafeUnwrap()

    const result = await (async () => {
      const lots = await tx<
        {
          id: string
          food_master_id: string
          delivery_id: string | null
          quantity: string
          received_date: string | null
          best_before: string | null
          eat_by: string | null
        }[]
      >`
        SELECT id, food_master_id, delivery_id, quantity::text AS quantity,
               received_date::text AS received_date,
               best_before::text AS best_before, eat_by::text AS eat_by
        FROM stock_lots
        WHERE delivery_id = 'dly_planned_food_merge'
      `
      const movements = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM stock_movements
        WHERE stock_lot_id IN ('stl_planned_survivor', 'stl_planned_loser')
      `
      return { lots, movements }
    })()

    expect(result).toEqual({
      lots: [
        {
          id: 'stl_planned_survivor',
          food_master_id: 'fm_survivor',
          delivery_id: 'dly_planned_food_merge',
          quantity: '5',
          received_date: null,
          best_before: null,
          eat_by: null,
        },
      ],
      movements: [{ count: '0' }],
    })
  })

  // A third food_master already owns the loser's name as an alias, so the
  // loser's name can't be added as a new alias on the survivor.
  const seedAliasNameConflictTrio = async (): Promise<void> => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_survivor',
      name: 'survivor food',
      source: 'user_input',
    })
    await seedFoodMaster(tx, {
      id: 'fm_loser',
      name: 'loser food',
      source: 'user_input',
    })
    await seedFoodMaster(tx, {
      id: 'fm_other',
      name: 'other food',
      source: 'user_input',
    })
    await seedFoodMasterAlias(tx, {
      id: 'fma_other_alias',
      foodMasterId: 'fm_other',
      alias: 'loser food',
    })
  }

  it("leaves nameMovedAsAlias null when the loser's name already belongs to another food_master's alias, on dry_run", async () => {
    await seedAliasNameConflictTrio()

    const result = (
      await repo.merge('fm_survivor', 'fm_loser', true)
    )._unsafeUnwrap()

    expect(result).toEqual({
      survivorId: 'fm_survivor',
      loserId: 'fm_loser',
      applied: false,
      movedAliases: [],
      nameMovedAsAlias: null,
      movedNutritionVersions: [{ previousVersionNo: 1, versionNo: 2 }],
      movedMealLogCount: 0,
    })
  })

  it('leaves nameMovedAsAlias null and does not duplicate the alias row, on apply', async () => {
    await seedAliasNameConflictTrio()

    const result = (
      await repo.merge('fm_survivor', 'fm_loser', false)
    )._unsafeUnwrap()

    expect(result).toEqual({
      survivorId: 'fm_survivor',
      loserId: 'fm_loser',
      applied: true,
      movedAliases: [],
      nameMovedAsAlias: null,
      movedNutritionVersions: [{ previousVersionNo: 1, versionNo: 2 }],
      movedMealLogCount: 0,
    })

    const tx = getTx()
    const aliasRows = await tx<{ food_master_id: string; alias: string }[]>`
      SELECT food_master_id, alias FROM food_master_aliases WHERE alias = 'loser food'
    `
    expect(aliasRows).toEqual([
      { food_master_id: 'fm_other', alias: 'loser food' },
    ])
  })

  it('rejects merging a food_master with itself', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_solo',
      name: 'solo food',
      source: 'user_input',
    })

    const captured = await captureDomainError(
      repo.merge('fm_solo', 'fm_solo', false),
    )

    expect(captured).toEqual({
      code: 'same_food_master',
      details: { foodMasterId: 'fm_solo' },
    })
  })

  it('rejects a merge when the survivor food_master does not exist', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_loser',
      name: 'loser food',
      source: 'user_input',
    })

    const captured = await captureDomainError(
      repo.merge('fm_missing', 'fm_loser', true),
    )

    expect(captured).toEqual({
      code: 'food_master_not_found',
      details: { foodMasterId: 'fm_missing' },
    })
  })

  it('rejects a merge when the loser food_master does not exist', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_survivor',
      name: 'survivor food',
      source: 'user_input',
    })

    const captured = await captureDomainError(
      repo.merge('fm_survivor', 'fm_missing', true),
    )

    expect(captured).toEqual({
      code: 'food_master_not_found',
      details: { foodMasterId: 'fm_missing' },
    })
  })
})
