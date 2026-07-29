import { errAsync, type ResultAsync } from 'neverthrow'

import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { FoodMasterRepository } from '#domain/food-master/repository'
import type {
  FoodMaster,
  FoodMasterId,
  RegisterFoodMasterInput,
} from '#domain/food-master/types'

export interface FoodMasterService {
  register(
    input: RegisterFoodMasterInput,
  ): ResultAsync<FoodMaster, FoodMasterDomainError>
  getById(
    id: FoodMasterId,
  ): ResultAsync<FoodMaster | null, FoodMasterDomainError>
  // Registers a food_master from a food_compositions row (source =
  // 'composition_table_estimate', isEstimated = true) — the "新規追加候補"
  // path in the meal log sheet's food search.
  registerFromComposition(
    compositionCode: string,
  ): ResultAsync<FoodMaster, FoodMasterDomainError>
}

export const createFoodMasterService = (
  repo: FoodMasterRepository,
): FoodMasterService => ({
  register: (input) => repo.register(input),
  getById: (id) => repo.findById(id),
  registerFromComposition: (compositionCode) =>
    repo.findComposition(compositionCode).andThen((composition) => {
      if (composition === null) {
        return errAsync(
          new FoodMasterDomainError(
            'composition_not_found',
            `food_composition not found: ${compositionCode}`,
            { compositionCode },
          ),
        )
      }
      return repo.register({
        name: composition.name,
        nutrition: composition.nutrition,
        source: 'composition_table_estimate',
        isEstimated: true,
      })
    }),
})
