import { beforeEach, expect, it } from 'vitest'

import {
  createFoodMasterRepository,
  type FoodMasterRepository,
} from '#domain/food-master/index'
import { captureDomainError } from '#test/capture-domain-error'
import { describeIfDb, setupTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import {
  seedFoodMaster,
  seedFoodMasterAlias,
  seedFoodMasterUnit,
  seedMealLog,
} from '#test/seed'

interface IdCounter {
  next(): number
}

const createCountingIdGenerator = (
  counter: IdCounter,
): ((prefix: string) => string) => {
  return (prefix) => `${prefix}_test_${String(counter.next()).padStart(4, '0')}`
}

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

  // Full seed shared by the "normal" scenarios (1-2): survivor and loser
  // each with their own alias, unit, nutrient and meal_log, and no
  // unit/alias conflicts between them.
  const seedBasicPair = async (): Promise<void> => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_survivor',
      name: 'survivor food',
      source: 'user_input',
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
    await seedFoodMasterUnit(tx, {
      foodMasterId: 'fm_survivor',
      unit: '個',
      gramsPerUnit: 50,
    })
    await seedFoodMasterUnit(tx, {
      foodMasterId: 'fm_loser',
      unit: '杯',
      gramsPerUnit: 150,
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
  }

  interface DbSnapshot {
    readonly foodMasters: ReadonlyArray<{ id: string; name: string }>
    readonly aliases: ReadonlyArray<{ foodMasterId: string; alias: string }>
    readonly units: ReadonlyArray<{
      foodMasterId: string
      unit: string
      gramsPerUnit: number
    }>
    readonly mealLogs: ReadonlyArray<{ id: string; foodMasterId: string }>
  }

  const snapshot = async (): Promise<DbSnapshot> => {
    const tx = getTx()
    const [foodMasters, aliases, units, mealLogs] = await Promise.all([
      tx<{ id: string; name: string }[]>`
        SELECT id, name FROM food_masters ORDER BY id
      `,
      tx<{ food_master_id: string; alias: string }[]>`
        SELECT food_master_id, alias FROM food_master_aliases ORDER BY alias
      `,
      tx<{ food_master_id: string; unit: string; grams_per_unit: string }[]>`
        SELECT food_master_id, unit, grams_per_unit FROM food_master_units
        ORDER BY food_master_id, unit
      `,
      tx<{ id: string; food_master_id: string }[]>`
        SELECT id, food_master_id FROM meal_logs ORDER BY id
      `,
    ])
    return {
      foodMasters,
      aliases: aliases.map((r) => ({
        foodMasterId: r.food_master_id,
        alias: r.alias,
      })),
      units: units.map((r) => ({
        foodMasterId: r.food_master_id,
        unit: r.unit,
        gramsPerUnit: Number(r.grams_per_unit),
      })),
      mealLogs: mealLogs.map((r) => ({
        id: r.id,
        foodMasterId: r.food_master_id,
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
      movedUnits: [{ unit: '杯', gramsPerUnit: 150 }],
      discardedUnits: [],
      discardedNutrition: { energy_kcal: 50, protein_g: 5 },
      movedMealLogCount: 1,
    })

    expect(await snapshot()).toEqual(before)
  })

  it('applies a merge (dry_run=false): moves aliases/units/meal_logs to the survivor and deletes the loser', async () => {
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
      movedUnits: [{ unit: '杯', gramsPerUnit: 150 }],
      discardedUnits: [],
      discardedNutrition: { energy_kcal: 50, protein_g: 5 },
      movedMealLogCount: 1,
    })

    expect(await snapshot()).toEqual({
      foodMasters: [{ id: 'fm_survivor', name: 'survivor food' }],
      aliases: [
        { foodMasterId: 'fm_survivor', alias: 'loser alias' },
        { foodMasterId: 'fm_survivor', alias: 'loser food' },
        { foodMasterId: 'fm_survivor', alias: 'survivor alias' },
      ],
      units: [
        { foodMasterId: 'fm_survivor', unit: '個', gramsPerUnit: 50 },
        { foodMasterId: 'fm_survivor', unit: '杯', gramsPerUnit: 150 },
      ],
      mealLogs: [
        { id: 'ml_loser', foodMasterId: 'fm_survivor' },
        { id: 'ml_survivor', foodMasterId: 'fm_survivor' },
      ],
    })

    const tx = getTx()
    const loserNutrients = await tx<{ food_master_id: string }[]>`
      SELECT food_master_id FROM food_master_nutrients
      WHERE food_master_id = 'fm_loser'
    `
    expect(loserNutrients).toEqual([])
  })

  // survivor and loser both define the same unit name with a different
  // grams_per_unit — the survivor's value must win in both dry_run and
  // apply, and the non-conflicting unit on each side still moves/stays.
  const seedUnitConflictPair = async (): Promise<void> => {
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
    await seedFoodMasterUnit(tx, {
      foodMasterId: 'fm_survivor',
      unit: '個',
      gramsPerUnit: 50,
    })
    await seedFoodMasterUnit(tx, {
      foodMasterId: 'fm_loser',
      unit: '個',
      gramsPerUnit: 60,
    })
    await seedFoodMasterUnit(tx, {
      foodMasterId: 'fm_loser',
      unit: '杯',
      gramsPerUnit: 150,
    })
  }

  it('discards a conflicting unit (survivor value wins) and still moves the non-conflicting one, on dry_run', async () => {
    await seedUnitConflictPair()

    const result = (
      await repo.merge('fm_survivor', 'fm_loser', true)
    )._unsafeUnwrap()

    expect(result).toEqual({
      survivorId: 'fm_survivor',
      loserId: 'fm_loser',
      applied: false,
      movedAliases: [],
      nameMovedAsAlias: 'loser food',
      movedUnits: [{ unit: '杯', gramsPerUnit: 150 }],
      discardedUnits: [{ unit: '個', gramsPerUnit: 60 }],
      discardedNutrition: {},
      movedMealLogCount: 0,
    })
  })

  it('discards a conflicting unit (survivor value wins) and still moves the non-conflicting one, on apply', async () => {
    await seedUnitConflictPair()

    const result = (
      await repo.merge('fm_survivor', 'fm_loser', false)
    )._unsafeUnwrap()

    expect(result).toEqual({
      survivorId: 'fm_survivor',
      loserId: 'fm_loser',
      applied: true,
      movedAliases: [],
      nameMovedAsAlias: 'loser food',
      movedUnits: [{ unit: '杯', gramsPerUnit: 150 }],
      discardedUnits: [{ unit: '個', gramsPerUnit: 60 }],
      discardedNutrition: {},
      movedMealLogCount: 0,
    })

    const tx = getTx()
    const units = await tx<{ unit: string; grams_per_unit: string }[]>`
      SELECT unit, grams_per_unit FROM food_master_units
      WHERE food_master_id = 'fm_survivor'
      ORDER BY unit
    `
    expect(
      units.map((r) => ({
        unit: r.unit,
        gramsPerUnit: Number(r.grams_per_unit),
      })),
    ).toEqual([
      { unit: '個', gramsPerUnit: 50 },
      { unit: '杯', gramsPerUnit: 150 },
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
      movedUnits: [],
      discardedUnits: [],
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
      movedUnits: [],
      discardedUnits: [],
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
