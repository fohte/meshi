import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { expect, it } from 'vitest'

import { createMealHistoryService } from '#domain/meal-history/mealHistoryService'
import { describeIfDb, setupTx, TEST_DATABASE_URL } from '#test/db'
import { jstDate } from '#test/jst-date'
import { seedFoodMaster, seedMealLog, seedNutrientDefinition } from '#test/seed'

const seedNutrientDefinitions = async (sql: postgres.Sql): Promise<void> => {
  await seedNutrientDefinition(sql, {
    code: 'energy_kcal',
    displayName: 'energy',
    unit: 'kcal',
    isMajor: true,
    sortOrder: 1,
  })
  await seedNutrientDefinition(sql, {
    code: 'protein_g',
    displayName: 'protein',
    unit: 'g',
    isMajor: true,
    sortOrder: 2,
  })
  await seedNutrientDefinition(sql, {
    code: 'iron_mg',
    displayName: 'iron',
    unit: 'mg',
    isMajor: false,
    sortOrder: 3,
  })
}

describeIfDb('MealHistoryService.query', () => {
  const getTx = setupTx()

  it('aggregates major nutrients by default within the period', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'rice',
      source: 'user_input',
      nutrients: { energy_kcal: 156, protein_g: 2.5, iron_mg: 0.1 },
    })
    await seedFoodMaster(tx, {
      id: 'egg',
      name: 'egg',
      source: 'user_input',
      nutrients: { energy_kcal: 142, protein_g: 12, iron_mg: 1.5 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenDate: jstDate('2026-06-01'),
      mealType: 'lunch',
      quantity: 200,
    })
    await seedMealLog(tx, {
      id: 'log-2',
      foodMasterId: 'egg',
      eatenDate: jstDate('2026-06-01'),
      mealType: 'dinner',
      quantity: 50,
    })
    await seedMealLog(tx, {
      id: 'log-3',
      foodMasterId: 'rice',
      eatenDate: jstDate('2026-06-02'),
      mealType: 'breakfast',
      quantity: 100,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: jstDate('2026-06-01'),
        periodTo: jstDate('2026-06-02'),
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: {
        energy_kcal: 156 * 200 + 142 * 50,
        protein_g: 2.5 * 200 + 12 * 50,
      },
      perDay: [
        {
          date: '2026-06-01',
          totals: {
            energy_kcal: 156 * 200 + 142 * 50,
            protein_g: 2.5 * 200 + 12 * 50,
          },
        },
      ],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'rice',
          foodName: 'rice',
          eatenDate: '2026-06-01',
          mealType: 'lunch',
          quantity: 200,
        },
        {
          id: 'log-2',
          foodMasterId: 'egg',
          foodName: 'egg',
          eatenDate: '2026-06-01',
          mealType: 'dinner',
          quantity: 50,
        },
      ],
      hasEstimatedValues: false,
    })
  })

  it('filters entries and aggregation by foodFilter', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'rice',
      source: 'user_input',
      nutrients: { energy_kcal: 156, protein_g: 2.5 },
    })
    await seedFoodMaster(tx, {
      id: 'egg',
      name: 'egg',
      source: 'user_input',
      nutrients: { energy_kcal: 142, protein_g: 12 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenDate: jstDate('2026-06-01'),
      mealType: 'lunch',
      quantity: 200,
    })
    await seedMealLog(tx, {
      id: 'log-2',
      foodMasterId: 'egg',
      eatenDate: jstDate('2026-06-01'),
      mealType: 'dinner',
      quantity: 50,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: jstDate('2026-06-01'),
        periodTo: jstDate('2026-06-02'),
        foodFilter: ['egg'],
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: { energy_kcal: 142 * 50, protein_g: 12 * 50 },
      perDay: [
        {
          date: '2026-06-01',
          totals: { energy_kcal: 142 * 50, protein_g: 12 * 50 },
        },
      ],
      entries: [
        {
          id: 'log-2',
          foodMasterId: 'egg',
          foodName: 'egg',
          eatenDate: '2026-06-01',
          mealType: 'dinner',
          quantity: 50,
        },
      ],
      hasEstimatedValues: false,
    })
  })

  it('aggregates only the specified nutrient codes when provided', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'spinach',
      name: 'spinach',
      source: 'user_input',
      nutrients: { energy_kcal: 25, protein_g: 2.2, iron_mg: 2 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'spinach',
      eatenDate: jstDate('2026-06-01'),
      mealType: 'lunch',
      quantity: 100,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: jstDate('2026-06-01'),
        periodTo: jstDate('2026-06-02'),
        nutrientCodes: ['iron_mg'],
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: { iron_mg: 2 * 100 },
      perDay: [
        {
          date: '2026-06-01',
          totals: { iron_mg: 2 * 100 },
        },
      ],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'spinach',
          foodName: 'spinach',
          eatenDate: '2026-06-01',
          mealType: 'lunch',
          quantity: 100,
        },
      ],
      hasEstimatedValues: false,
    })
  })

  it('returns empty totals when nutrientCodes is an empty array', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'rice',
      source: 'user_input',
      nutrients: { energy_kcal: 156, protein_g: 2.5 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenDate: jstDate('2026-06-01'),
      mealType: 'lunch',
      quantity: 100,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: jstDate('2026-06-01'),
        periodTo: jstDate('2026-06-02'),
        nutrientCodes: [],
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: {},
      perDay: [],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'rice',
          foodName: 'rice',
          eatenDate: '2026-06-01',
          mealType: 'lunch',
          quantity: 100,
        },
      ],
      hasEstimatedValues: false,
    })
  })

  it('sets hasEstimatedValues=true when any matching meal references an estimated food', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'rice',
      source: 'user_input',
      nutrients: { energy_kcal: 156, protein_g: 2.5 },
    })
    await seedFoodMaster(tx, {
      id: 'mystery_stew',
      name: 'mystery stew',
      isEstimated: true,
      source: 'user_input',
      nutrients: { energy_kcal: 200, protein_g: 8 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenDate: jstDate('2026-06-01'),
      mealType: 'lunch',
      quantity: 100,
    })
    await seedMealLog(tx, {
      id: 'log-2',
      foodMasterId: 'mystery_stew',
      eatenDate: jstDate('2026-06-01'),
      mealType: 'dinner',
      quantity: 250,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: jstDate('2026-06-01'),
        periodTo: jstDate('2026-06-02'),
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: {
        energy_kcal: 156 * 100 + 200 * 250,
        protein_g: 2.5 * 100 + 8 * 250,
      },
      perDay: [
        {
          date: '2026-06-01',
          totals: {
            energy_kcal: 156 * 100 + 200 * 250,
            protein_g: 2.5 * 100 + 8 * 250,
          },
        },
      ],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'rice',
          foodName: 'rice',
          eatenDate: '2026-06-01',
          mealType: 'lunch',
          quantity: 100,
        },
        {
          id: 'log-2',
          foodMasterId: 'mystery_stew',
          foodName: 'mystery stew',
          eatenDate: '2026-06-01',
          mealType: 'dinner',
          quantity: 250,
        },
      ],
      hasEstimatedValues: true,
    })
  })
})

// Reproduces main.ts's production wiring, where createMealHistoryService
// shares a connection pool with repositories that construct drizzle() on
// it. drizzle-orm's postgres-js driver mutates that pool's own
// options.serializers/parsers for timestamp/date OIDs to identity
// pass-through as a side effect of construction (see the comment in
// mealHistoryService.ts). A setupTx()/setupDrizzleTx() reserved connection
// can't reproduce this: postgres.js's wire encoding always reads the
// pool's original options object regardless of what a reserved
// connection's own `.options` property holds, and setupDrizzleTx()
// deliberately clones rather than shares that object so other tests
// aren't corrupted — so drizzle() must be constructed on a pool's actual
// top-level `sql` for the mutation to take effect, which this test does on
// its own throwaway pool instead of the shared test pool.
describeIfDb(
  'meal history query survives a drizzle()-corrupted connection pool',
  () => {
    it('still binds periodFrom/periodTo and reads back eaten_date correctly', async () => {
      if (TEST_DATABASE_URL === undefined) {
        throw new Error('TEST_DATABASE_URL is not set')
      }
      const pool = postgres(TEST_DATABASE_URL, { max: 1 })
      drizzle(pool)

      class RollbackTestChanges extends Error {}

      try {
        await pool.begin(async (transactionSql) => {
          // seedFoodMaster/seedNutrientDefinition/createMealHistoryService
          // only use the tagged-template + .typed() surface, which
          // TransactionSql has too; the pool-management members TypeScript
          // wants (end, options, ...) are never touched on a tx.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- see comment above.
          const tx = transactionSql as unknown as postgres.Sql
          // A test-only nutrient code, not the 'energy_kcal'/'protein_g'
          // codes other test files also seed concurrently: this test's
          // transaction holds row locks on nutrient_definitions until
          // rollback, and a shared code risks a deadlock against a
          // concurrently-running file inserting the same code in a
          // different order.
          await seedNutrientDefinition(tx, {
            code: 'probe_energy_kcal',
            displayName: 'energy',
            unit: 'kcal',
            isMajor: true,
            sortOrder: 1,
          })
          await seedFoodMaster(tx, {
            id: 'probe_rice',
            name: 'rice',
            source: 'user_input',
            nutrients: { probe_energy_kcal: 156 },
          })
          await seedMealLog(tx, {
            id: 'probe_log_1',
            foodMasterId: 'probe_rice',
            eatenDate: jstDate('2026-06-01'),
            mealType: 'lunch',
            quantity: 200,
          })

          const service = createMealHistoryService(tx)
          const result = (
            await service.query({
              periodFrom: jstDate('2026-06-01'),
              periodTo: jstDate('2026-06-02'),
            })
          )._unsafeUnwrap()

          expect(result).toEqual({
            totals: { probe_energy_kcal: 156 * 200 },
            perDay: [
              {
                date: '2026-06-01',
                totals: { probe_energy_kcal: 156 * 200 },
              },
            ],
            entries: [
              {
                id: 'probe_log_1',
                foodMasterId: 'probe_rice',
                foodName: 'rice',
                eatenDate: '2026-06-01',
                mealType: 'lunch',
                quantity: 200,
              },
            ],
            hasEstimatedValues: false,
          })

          throw new RollbackTestChanges('roll back test-only writes')
        })
      } catch (caughtErr) {
        if (!(caughtErr instanceof RollbackTestChanges)) throw caughtErr
      } finally {
        await pool.end({ timeout: 1 })
      }
    })
  },
)
