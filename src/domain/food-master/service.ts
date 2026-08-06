import { errAsync, type ResultAsync } from 'neverthrow'

import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { FoodMasterRepository } from '#domain/food-master/repository'
import type {
  FoodMaster,
  FoodMasterId,
  FoodMasterUnitDefinition,
  RegisterFoodMasterInput,
} from '#domain/food-master/types'

export interface RegisterFromCompositionInput {
  readonly compositionCode: string
  readonly name?: string
  readonly aliases?: ReadonlyArray<string>
  readonly units?: ReadonlyArray<FoodMasterUnitDefinition>
}

export interface RegisteredFromComposition {
  readonly foodMaster: FoodMaster
  readonly compositionName: string
}

export interface FoodMasterService {
  register(
    input: RegisterFoodMasterInput,
  ): ResultAsync<FoodMaster, FoodMasterDomainError>
  getById(
    id: FoodMasterId,
  ): ResultAsync<FoodMaster | null, FoodMasterDomainError>
  // Registers a food_master from a food_compositions row (source =
  // 'composition_table_estimate', isEstimated = true) — the "新規追加候補"
  // path in the meal log sheet's food search. name/aliases/units may
  // override the composition row's own name/serving definitions; nutrition
  // always comes verbatim from the composition table.
  registerFromComposition(
    input: RegisterFromCompositionInput,
  ): ResultAsync<RegisteredFromComposition, FoodMasterDomainError>
  addAlias(
    id: FoodMasterId,
    alias: string,
  ): ResultAsync<void, FoodMasterDomainError>
}

export const createFoodMasterService = (
  repo: FoodMasterRepository,
): FoodMasterService => ({
  register: (input) => repo.register(input),
  getById: (id) => repo.findById(id),
  addAlias: (id, alias) => repo.addAlias(id, alias),
  registerFromComposition: (input) =>
    repo.findComposition(input.compositionCode).andThen((composition) => {
      if (composition === null) {
        return errAsync(
          new FoodMasterDomainError(
            'composition_not_found',
            `food_composition not found: ${input.compositionCode}`,
            { compositionCode: input.compositionCode },
          ),
        )
      }
      return repo
        .register({
          name: input.name ?? composition.name,
          nutrition: composition.nutrition,
          source: 'composition_table_estimate',
          isEstimated: true,
          sourceCompositionCode: input.compositionCode,
          ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
          ...(input.units !== undefined ? { units: input.units } : {}),
        })
        .map((foodMaster) => ({
          foodMaster,
          compositionName: composition.name,
        }))
    }),
})
