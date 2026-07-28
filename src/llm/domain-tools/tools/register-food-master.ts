import { z } from 'zod'

import { NUTRIENT_CODES } from '#db/seed/nutrient-definitions'
import type { FoodMasterService } from '#domain/food-master/service'
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
// from normalizeAndValidate (repository.ts) is enforced with .refine() and
// spelled out in the description below rather than the JSON Schema.
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
  })
  .refine((v) => !(v.is_estimated && v.source === 'web_search'), {
    message: "is_estimated=true must not be combined with source='web_search'",
    path: ['is_estimated'],
  })
  .refine(
    (v) => {
      const aliases = (v.aliases ?? []).map((a) => a.trim())
      return new Set(aliases).size === aliases.length
    },
    {
      message: 'aliases must not contain duplicates within the same input',
      path: ['aliases'],
    },
  )

export interface RegisterFoodMasterOutput {
  readonly food_master_id: string
}

export const createRegisterFoodMasterTool = (
  service: FoodMasterService,
): DomainTool => ({
  name: 'register_food_master',
  description:
    'Register a new food_master row with per-100g nutrition values. source=web_search requires is_estimated=false (pair it with source_url for confirmed values); composition_table_estimate and user_input allow is_estimated to be true or false.',
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
      })
      .map((master) => ({ food_master_id: master.id }))
      .mapErr((e): ToolError => ({
        code: `food_master/${e.code}`,
        message: e.message,
        details: e.details,
      }))
  },
})
