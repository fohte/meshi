import { z } from 'zod'

import type { FoodMasterService } from '#domain/food-master/service'
import { hasDuplicateAfterTrim } from '#domain/food-master/validation'
import { NON_BLANK, parseToolInput } from '#llm/domain-tools/parse'
import {
  type DomainTool,
  err,
  type Result,
  type ToolError,
} from '#llm/domain-tools/types'

const inputSchema = z
  .object({
    composition_code: z.string().min(1),
    name: z.string().min(1).regex(NON_BLANK).optional(),
    aliases: z.array(z.string().min(1).regex(NON_BLANK)).optional(),
  })
  .refine((v) => !hasDuplicateAfterTrim(v.aliases ?? []), {
    message: 'aliases must not contain duplicates within the same input',
    path: ['aliases'],
  })

export interface RegisterFoodMasterFromCompositionOutput {
  readonly food_master_id: string
  readonly name: string
  readonly composition_code: string
  readonly composition_name: string
  readonly nutrition_per_100g: Readonly<Record<string, number>>
}

export const createRegisterFoodMasterFromCompositionTool = (
  service: FoodMasterService,
): DomainTool => ({
  name: 'register_food_master_from_composition',
  description:
    "Register a new food_master using the exact per-100g nutrition values from a food_compositions row — use the composition_code a search_food_master candidate returned (reason='composition_table'). Nutrition values are copied verbatim from the composition table; you cannot supply or adjust them. Pass name/aliases only to register under a more specific product name (e.g. a branded snack) while the nutrition still comes from the matched generic composition entry — mention that substitution to the user in your reply so they can correct it if the composition entry is a poor match.",
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<RegisterFoodMasterFromCompositionOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)
    return await service
      .registerFromComposition({
        compositionCode: parsed.value.composition_code,
        ...(parsed.value.name === undefined ? {} : { name: parsed.value.name }),
        ...(parsed.value.aliases === undefined
          ? {}
          : { aliases: parsed.value.aliases }),
      })
      .map(({ foodMaster, compositionName }) => ({
        food_master_id: foodMaster.id,
        name: foodMaster.name,
        composition_code: parsed.value.composition_code,
        composition_name: compositionName,
        nutrition_per_100g: foodMaster.nutrition,
      }))
      .mapErr((e): ToolError => ({
        code: `food_master/${e.code}`,
        message: e.message,
        details: e.details,
      }))
  },
})
