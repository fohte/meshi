import type { FoodMasterRepository } from '@/domain/food-master/repository'
import type {
  FoodMaster,
  FoodMasterId,
  RegisterFoodMasterInput,
} from '@/domain/food-master/types'

export interface FoodMasterService {
  register(input: RegisterFoodMasterInput): Promise<FoodMaster>
  getById(id: FoodMasterId): Promise<FoodMaster | null>
}

export const createFoodMasterService = (
  repo: FoodMasterRepository,
): FoodMasterService => ({
  register: (input) => repo.register(input),
  getById: (id) => repo.findById(id),
})
