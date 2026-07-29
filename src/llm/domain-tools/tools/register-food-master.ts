import { z } from 'zod'

import { NUTRIENT_CODES } from '#db/seed/nutrient-definitions'
import type { FoodMasterService } from '#domain/food-master/service'
import {
  hasDuplicateAfterTrim,
  isInvalidSourceCombination,
} from '#domain/food-master/validation'
import { parseToolInput } from '#llm/domain-tools/parse'
import {
  type DomainTool,
  err,
  type Result,
  type ToolError,
} from '#llm/domain-tools/types'

// Rejects both the empty string and whitespace-only strings, matching the
// trim-then-check-empty rule in normalizeAndValidate (repository.ts).
const NON_BLANK = /\S/

// Anthropic's and OpenAI's tool-calling APIs reject oneOf/anyOf/allOf at the
// root of a tool's input schema, so the source/is_estimated combination rule
// is enforced with .refine() and spelled out in the description below rather
// than the JSON Schema.
const unitDefinitionInput = z.object({
  unit: z.string().min(1).regex(NON_BLANK),
  grams_per_unit: z.number().positive(),
})

const inputSchema = z
  .object({
    name: z.string().min(1).regex(NON_BLANK),
    aliases: z.array(z.string().min(1).regex(NON_BLANK)).optional(),
    nutrition_per_100g: z.partialRecord(
      z.enum(NUTRIENT_CODES),
      z.number().nonnegative(),
    ),
    source: z.enum(['web_search', 'composition_table_estimate', 'user_input']),
    is_estimated: z.boolean(),
    source_url: z.url().optional(),
    units: z.array(unitDefinitionInput).optional(),
  })
  .refine((v) => !isInvalidSourceCombination(v.source, v.is_estimated), {
    message: "is_estimated=true must not be combined with source='web_search'",
    path: ['is_estimated'],
  })
  .refine((v) => !hasDuplicateAfterTrim(v.aliases ?? []), {
    message: 'aliases must not contain duplicates within the same input',
    path: ['aliases'],
  })

export interface RegisterFoodMasterOutput {
  readonly food_master_id: string
}

export const createRegisterFoodMasterTool = (
  service: FoodMasterService,
): DomainTool => ({
  name: 'register_food_master',
  description:
    "Register a new food_master row with per-100g nutrition values. source=web_search requires is_estimated=false (pair it with source_url for confirmed values); composition_table_estimate and user_input allow is_estimated to be true or false. Pass units for every non-mass unit (個/杯/ml/...) this food might later be recorded with — record_meal_log rejects a unit it can't resolve to grams, so add every unit the user is likely to use (g/kg/mg need no entry). If a unit is missing later, use register_food_master_unit to add it instead of re-registering the food.",
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<RegisterFoodMasterOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)
    return await service
      .register({
        name: parsed.value.name,
        nutrition: parsed.value.nutrition_per_100g,
        source: parsed.value.source,
        isEstimated: parsed.value.is_estimated,
        ...(parsed.value.aliases === undefined
          ? {}
          : { aliases: parsed.value.aliases }),
        ...(parsed.value.source_url === undefined
          ? {}
          : { sourceUrl: parsed.value.source_url }),
        ...(parsed.value.units === undefined
          ? {}
          : {
              units: parsed.value.units.map((u) => ({
                unit: u.unit,
                gramsPerUnit: u.grams_per_unit,
              })),
            }),
      })
      .map((master) => ({ food_master_id: master.id }))
      .mapErr((e): ToolError => ({
        code: `food_master/${e.code}`,
        message: e.message,
        details: e.details,
      }))
  },
})
