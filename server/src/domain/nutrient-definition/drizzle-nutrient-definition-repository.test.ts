import { expect, it } from 'vitest'

import { createDrizzleNutrientDefinitionRepository } from '#domain/nutrient-definition/drizzle-nutrient-definition-repository'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { seedNutrientDefinition } from '#test/seed'

describeIfDb('createDrizzleNutrientDefinitionRepository', () => {
  const getTx = setupDrizzleTx()

  it('lists definitions ordered by isMajor desc, then sortOrder asc', async () => {
    const tx = getTx()
    // Test-only codes, not the 'energy_kcal'/'protein_g'/'iron_mg' codes
    // other test files also seed concurrently: this test's transaction holds
    // row locks on nutrient_definitions until rollback, and a shared code
    // risks a deadlock against a concurrently-running file inserting the
    // same code in a different order (see the same caveat in
    // mealHistoryService.test.ts).
    await seedNutrientDefinition(tx, {
      code: 'ndr_test_iron_mg',
      displayName: 'iron',
      unit: 'mg',
      isMajor: false,
      sortOrder: 1,
    })
    await seedNutrientDefinition(tx, {
      code: 'ndr_test_protein_g',
      displayName: 'protein',
      unit: 'g',
      isMajor: true,
      sortOrder: 2,
    })
    await seedNutrientDefinition(tx, {
      code: 'ndr_test_energy_kcal',
      displayName: 'energy',
      unit: 'kcal',
      isMajor: true,
      sortOrder: 1,
    })

    const repo = createDrizzleNutrientDefinitionRepository(tx)
    const result = (await repo.list())._unsafeUnwrap()

    expect(result).toEqual([
      {
        code: 'ndr_test_energy_kcal',
        displayName: 'energy',
        unit: 'kcal',
        isMajor: true,
        sortOrder: 1,
      },
      {
        code: 'ndr_test_protein_g',
        displayName: 'protein',
        unit: 'g',
        isMajor: true,
        sortOrder: 2,
      },
      {
        code: 'ndr_test_iron_mg',
        displayName: 'iron',
        unit: 'mg',
        isMajor: false,
        sortOrder: 1,
      },
    ])
  })
})
