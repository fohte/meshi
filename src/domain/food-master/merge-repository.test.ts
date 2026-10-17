import { beforeEach, expect, it } from 'vitest'

import { createFoodMasterRepository } from '#domain/food-master/index'
import type { FoodMasterRepository } from '#domain/food-master/repository'
import { captureDomainError } from '#test/capture-domain-error'
import { describeIfDb, setupTx } from '#test/db'
import { createCountingIdGenerator, type IdCounter } from '#test/id-counter'
import { jstDate } from '#test/jst-date'
import {
  seedFoodMaster,
  seedFoodMasterAlias,
  seedMealLog,
  seedMealSet,
  seedMealSetItem,
  seedStockItem,
  seedStockLot,
  seedStockMovement,
  seedStorageLocation,
} from '#test/seed'

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
    readonly mealLogs: ReadonlyArray<{ id: string; foodMasterId: string }>
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
        FROM food_master_nutrition ORDER BY food_master_id
      `,
      tx<{ food_master_id: string; alias: string }[]>`
        SELECT food_master_id, alias FROM food_master_aliases ORDER BY alias
      `,
      tx<{ food_master_id: string; nutrient_code: string }[]>`
        SELECT food_master_id, nutrient_code FROM food_master_nutrients
        ORDER BY food_master_id, nutrient_code
      `,
      tx<{ id: string; food_master_id: string }[]>`
        SELECT id, food_master_id FROM meal_logs ORDER BY id
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
      discardedNutrition: { energy_kcal: 50, protein_g: 5 },
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
      discardedNutrition: { energy_kcal: 50, protein_g: 5 },
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
      // The loser's own nutrients (energy_kcal, protein_g) are gone —
      // cascade-deleted with the loser row, never moved to the survivor.
      nutrients: [{ foodMasterId: 'fm_survivor', nutrientCode: 'energy_kcal' }],
      mealLogs: [
        { id: 'ml_loser', foodMasterId: 'fm_survivor' },
        { id: 'ml_survivor', foodMasterId: 'fm_survivor' },
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
      discardedNutrition: {},
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
      discardedNutrition: {},
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
