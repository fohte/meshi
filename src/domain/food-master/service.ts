import type { ResultAsync } from 'neverthrow'

import type { FoodMasterDomainError } from '@/domain/food-master/errors'
import type { FoodMasterRepository } from '@/domain/food-master/repository'
import type {
  FoodMaster,
  FoodMasterId,
  RegisterFoodMasterInput,
} from '@/domain/food-master/types'

export interface FoodMasterService {
  register(
    input: RegisterFoodMasterInput,
  ): ResultAsync<FoodMaster, FoodMasterDomainError>
  getById(
    id: FoodMasterId,
  ): ResultAsync<FoodMaster | null, FoodMasterDomainError>
}

export const createFoodMasterService = (
  repo: FoodMasterRepository,
): FoodMasterService => ({
  register: (input) => repo.register(input),
  getById: (id) => repo.findById(id),
})
