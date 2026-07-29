import type { ResultAsync } from 'neverthrow'
import { expect, it } from 'vitest'

import {
  createFoodMasterUnitRepository,
  createFoodMasterUnitService,
  type FoodMasterUnitDomainError,
  type FoodMasterUnitService,
} from '#domain/food-master-unit/index'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { seedFoodMaster } from '#test/seed'

const captureDomainError = async (
  resultAsync: ResultAsync<unknown, FoodMasterUnitDomainError>,
): Promise<{ code: string; details: Readonly<Record<string, unknown>> }> => {
  const result = await resultAsync
  if (result.isOk()) {
    throw new Error('expected FoodMasterUnitDomainError but got Ok')
  }
  return { code: result.error.code, details: result.error.details }
}

describeIfDb('FoodMasterUnitService + Repository', () => {
  const getTx = setupDrizzleTx()
  let service: FoodMasterUnitService

  const seedRice = async (): Promise<void> => {
    await seedFoodMaster(getTx(), {
      id: 'fm_rice',
      name: 'rice',
      source: 'user_input',
    })
  }

  it('registers a unit for an existing food_master', async () => {
    await seedRice()
    service = createFoodMasterUnitService(
      createFoodMasterUnitRepository(getTx()),
    )

    const registered = (
      await service.register({
        foodMasterId: 'fm_rice',
        unit: '杯',
        gramsPerUnit: 150,
      })
    )._unsafeUnwrap()

    expect(registered).toEqual({
      foodMasterId: 'fm_rice',
      unit: '杯',
      gramsPerUnit: 150,
    })
  })

  it('normalizes the unit to trimmed lowercase before storing', async () => {
    await seedRice()
    service = createFoodMasterUnitService(
      createFoodMasterUnitRepository(getTx()),
    )

    const registered = (
      await service.register({
        foodMasterId: 'fm_rice',
        unit: ' ML ',
        gramsPerUnit: 1.04,
      })
    )._unsafeUnwrap()

    expect(registered).toEqual({
      foodMasterId: 'fm_rice',
      unit: 'ml',
      gramsPerUnit: 1.04,
    })
  })

  it('rejects an empty unit string', async () => {
    await seedRice()
    service = createFoodMasterUnitService(
      createFoodMasterUnitRepository(getTx()),
    )

    const captured = await captureDomainError(
      service.register({
        foodMasterId: 'fm_rice',
        unit: '  ',
        gramsPerUnit: 55,
      }),
    )

    expect(captured).toEqual({ code: 'empty_unit', details: {} })
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 20_000])(
    'rejects an implausible grams_per_unit %p',
    async (gramsPerUnit) => {
      await seedRice()
      service = createFoodMasterUnitService(
        createFoodMasterUnitRepository(getTx()),
      )

      const captured = await captureDomainError(
        service.register({ foodMasterId: 'fm_rice', unit: '個', gramsPerUnit }),
      )

      expect(captured).toEqual({
        code: 'implausible_grams_per_unit',
        details: { unit: '個', gramsPerUnit },
      })
    },
  )

  it('rejects a unit already defined for the same food_master with duplicate_unit', async () => {
    await seedRice()
    service = createFoodMasterUnitService(
      createFoodMasterUnitRepository(getTx()),
    )
    ;(
      await service.register({
        foodMasterId: 'fm_rice',
        unit: '杯',
        gramsPerUnit: 150,
      })
    )._unsafeUnwrap()

    const captured = await captureDomainError(
      service.register({
        foodMasterId: 'fm_rice',
        unit: ' 杯 ',
        gramsPerUnit: 160,
      }),
    )

    expect(captured).toEqual({
      code: 'duplicate_unit',
      details: { foodMasterId: 'fm_rice', unit: '杯' },
    })
  })

  it('rejects an unknown food_master_id with food_master_not_found', async () => {
    service = createFoodMasterUnitService(
      createFoodMasterUnitRepository(getTx()),
    )

    const captured = await captureDomainError(
      service.register({
        foodMasterId: 'fm_does_not_exist',
        unit: '個',
        gramsPerUnit: 55,
      }),
    )

    expect(captured).toEqual({
      code: 'food_master_not_found',
      details: { foodMasterId: 'fm_does_not_exist' },
    })
  })
})
