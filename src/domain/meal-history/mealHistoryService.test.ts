import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { expect, it } from 'vitest'

import { createMealHistoryService } from '@/domain/meal-history/mealHistoryService'
import { describeIfDb, setupTx, TEST_DATABASE_URL } from '@/test/db'
import {
  seedFoodMaster,
  seedMealLog,
  seedNutrientDefinition,
} from '@/test/seed'

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
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 200,
    })
    await seedMealLog(tx, {
      id: 'log-2',
      foodMasterId: 'egg',
      eatenAt: new Date('2026-06-01T12:00:00Z'),
      quantity: 50,
    })
    await seedMealLog(tx, {
      id: 'log-3',
      foodMasterId: 'rice',
      eatenAt: new Date('2026-06-02T00:00:00Z'),
      quantity: 100,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: new Date('2026-06-01T00:00:00Z'),
        periodTo: new Date('2026-06-02T00:00:00Z'),
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: {
        energy_kcal: 156 * 2 + 142 * 0.5,
        protein_g: 2.5 * 2 + 12 * 0.5,
      },
      perDay: [
        {
          date: '2026-06-01',
          totals: {
            energy_kcal: 156 * 2 + 142 * 0.5,
            protein_g: 2.5 * 2 + 12 * 0.5,
          },
        },
      ],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'rice',
          eatenAt: new Date('2026-06-01T03:00:00Z'),
          quantity: 200,
          unit: 'g',
          note: null,
        },
        {
          id: 'log-2',
          foodMasterId: 'egg',
          eatenAt: new Date('2026-06-01T12:00:00Z'),
          quantity: 50,
          unit: 'g',
          note: null,
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
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 200,
    })
    await seedMealLog(tx, {
      id: 'log-2',
      foodMasterId: 'egg',
      eatenAt: new Date('2026-06-01T12:00:00Z'),
      quantity: 50,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: new Date('2026-06-01T00:00:00Z'),
        periodTo: new Date('2026-06-02T00:00:00Z'),
        foodFilter: ['egg'],
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: { energy_kcal: 71, protein_g: 6 },
      perDay: [
        {
          date: '2026-06-01',
          totals: { energy_kcal: 71, protein_g: 6 },
        },
      ],
      entries: [
        {
          id: 'log-2',
          foodMasterId: 'egg',
          eatenAt: new Date('2026-06-01T12:00:00Z'),
          quantity: 50,
          unit: 'g',
          note: null,
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
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 100,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: new Date('2026-06-01T00:00:00Z'),
        periodTo: new Date('2026-06-02T00:00:00Z'),
        nutrientCodes: ['iron_mg'],
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: { iron_mg: 2 },
      perDay: [
        {
          date: '2026-06-01',
          totals: { iron_mg: 2 },
        },
      ],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'spinach',
          eatenAt: new Date('2026-06-01T03:00:00Z'),
          quantity: 100,
          unit: 'g',
          note: null,
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
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 100,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: new Date('2026-06-01T00:00:00Z'),
        periodTo: new Date('2026-06-02T00:00:00Z'),
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
          eatenAt: new Date('2026-06-01T03:00:00Z'),
          quantity: 100,
          unit: 'g',
          note: null,
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
      source: 'composition_table_estimate',
      nutrients: { energy_kcal: 200, protein_g: 8 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 100,
    })
    await seedMealLog(tx, {
      id: 'log-2',
      foodMasterId: 'mystery_stew',
      eatenAt: new Date('2026-06-01T12:00:00Z'),
      quantity: 250,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: new Date('2026-06-01T00:00:00Z'),
        periodTo: new Date('2026-06-02T00:00:00Z'),
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: {
        energy_kcal: 156 + 200 * 2.5,
        protein_g: 2.5 + 8 * 2.5,
      },
      perDay: [
        {
          date: '2026-06-01',
          totals: {
            energy_kcal: 156 + 200 * 2.5,
            protein_g: 2.5 + 8 * 2.5,
          },
        },
      ],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'rice',
          eatenAt: new Date('2026-06-01T03:00:00Z'),
          quantity: 100,
          unit: 'g',
          note: null,
        },
        {
          id: 'log-2',
          foodMasterId: 'mystery_stew',
          eatenAt: new Date('2026-06-01T12:00:00Z'),
          quantity: 250,
          unit: 'g',
          note: null,
        },
      ],
      hasEstimatedValues: true,
    })
  })
})

// Reproduces main.ts's production wiring, where createMealHistoryService
// shares a connection pool with repositories that construct drizzle() on
// it. drizzle-orm's postgres-js driver mutates that pool's own
// options.serializers/parsers for timestamp OIDs to identity pass-through
// as a side effect of construction (see the comment in
// mealHistoryService.ts). A setupTx()/setupDrizzleTx() reserved connection
// can't reproduce this: postgres.js's wire encoding always reads the
// pool's original options object regardless of what a reserved
// connection's own `.options` property holds, and setupDrizzleTx()
// deliberately clones rather than shares that object so other tests
// aren't corrupted — so drizzle() must be constructed on a pool's actual
// top-level `sql` for the mutation to take effect, which this test does on
// its own throwaway pool instead of the shared test pool.
describeIfDb(
  'MealHistoryService.query against a drizzle()-corrupted pool',
  () => {
    it('still binds periodFrom/periodTo and reads back eaten_at correctly', async () => {
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
          // Not seedMealLog() from @/test/seed: it binds eaten_at as a raw
          // Date too, so it would fail against this corrupted pool the same
          // way the pre-fix mealHistoryService.ts did.
          await tx`
            INSERT INTO meal_logs (id, food_master_id, eaten_at, quantity, unit)
            VALUES ('probe_log_1', 'probe_rice', '2026-06-01T03:00:00Z'::timestamptz, 200, 'g')
          `

          const service = createMealHistoryService(tx)
          const result = (
            await service.query({
              periodFrom: new Date('2026-06-01T00:00:00Z'),
              periodTo: new Date('2026-06-02T00:00:00Z'),
            })
          )._unsafeUnwrap()

          expect(result).toEqual({
            totals: { probe_energy_kcal: 312 },
            perDay: [
              {
                date: '2026-06-01',
                totals: { probe_energy_kcal: 312 },
              },
            ],
            entries: [
              {
                id: 'probe_log_1',
                foodMasterId: 'probe_rice',
                eatenAt: new Date('2026-06-01T03:00:00Z'),
                quantity: 200,
                unit: 'g',
                note: null,
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
