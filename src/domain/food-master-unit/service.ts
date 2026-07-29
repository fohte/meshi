import type { ResultAsync } from 'neverthrow'

import type { FoodMasterUnitDomainError } from '#domain/food-master-unit/errors'
import type { FoodMasterUnitRepository } from '#domain/food-master-unit/repository'
import type {
  FoodMasterUnit,
  RegisterFoodMasterUnitInput,
} from '#domain/food-master-unit/types'

export interface FoodMasterUnitService {
  register(
    input: RegisterFoodMasterUnitInput,
  ): ResultAsync<FoodMasterUnit, FoodMasterUnitDomainError>
}

export const createFoodMasterUnitService = (
  repo: FoodMasterUnitRepository,
): FoodMasterUnitService => ({
  register: (input) => repo.register(input),
})
