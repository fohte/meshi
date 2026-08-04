import { z } from 'zod'

import { NUTRIENT_CODES } from '#db/seed/nutrient-definitions'
import type { FoodMasterService } from '#domain/food-master/service'
import {
  hasDuplicateAfterTrim,
  isInvalidSourceCombination,
  validateSourceEvidence,
} from '#domain/food-master/validation'
import { NON_BLANK, parseToolInput } from '#llm/domain-tools/parse'
import {
  type DomainTool,
  err,
  type Result,
  type ToolError,
} from '#llm/domain-tools/types'

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
    nutrition_per_basis: z.partialRecord(
      z.enum(NUTRIENT_CODES),
      z.number().nonnegative(),
    ),
    basis_quantity: z.number().positive().optional(),
    basis_unit: z.string().min(1).regex(NON_BLANK).optional(),
    source: z.enum(['web_search', 'user_input']),
    is_estimated: z.boolean(),
    source_url: z
      .url()
      .refine((url) => !/[\r\n]/.test(url), {
        message: 'source_url must not contain control characters',
      })
      .optional(),
    units: z.array(unitDefinitionInput).optional(),
  })
  .refine((v) => !isInvalidSourceCombination(v.source, v.is_estimated), {
    message: "is_estimated=true must not be combined with source='web_search'",
    path: ['is_estimated'],
  })
  .refine(
    (v) =>
      validateSourceEvidence({
        source: v.source,
        sourceUrl: v.source_url ?? null,
        sourceCompositionCode: null,
      }) === null,
    {
      message:
        "source='web_search' requires source_url; source_url must not be set when source='user_input'",
      path: ['source_url'],
    },
  )
  .refine((v) => !hasDuplicateAfterTrim(v.aliases ?? []), {
    message: 'aliases must not contain duplicates within the same input',
    path: ['aliases'],
  })

export interface RegisterFoodMasterOutput {
  readonly food_master_id: string
  readonly name: string
  readonly source: 'web_search' | 'user_input'
  readonly source_url: string | null
  // Field name kept as nutrition_per_100g (not nutrition_per_basis) because
  // src/a2a/food-master-disclosure.ts parses this exact key from the tool's
  // JSON result; it now holds the value at whatever basis_quantity/basis_unit
  // resolved to below, not necessarily per 100g.
  readonly nutrition_per_100g: Readonly<Record<string, number>>
  readonly basis_quantity: number
  readonly basis_unit: string
}

export const createRegisterFoodMasterTool = (
  service: FoodMasterService,
): DomainTool => ({
  name: 'register_food_master',
  description:
    "Register a new food_master row, source=web_search or source=user_input only — never fabricate nutrition values or a serving-size gram amount from your own general knowledge. Pass nutrition_per_basis at whatever quantity your evidence actually states (per 100g, per serving, per meal, ...) together with matching basis_quantity/basis_unit; omit both to default to (100, 'g'). When evidence gives a per-serving or per-meal figure without stating that serving's weight (e.g. a restaurant menu's \"1食913kcal\"), register it at that basis directly — basis_quantity=1, basis_unit='食' or whatever serving noun the evidence itself uses — instead of searching for or estimating that serving's weight in grams to force a per-100g conversion; record_meal_log then records this food using that same basis unit. If the food is backed by a food_compositions row (search_food_master returned a candidate with a composition_code), use register_food_master_from_composition instead, which copies the composition's own per-100g nutrition verbatim. source=web_search requires is_estimated=false and source_url set to the page you found the values on. source=user_input is for values the user themselves stated in their message; is_estimated may be true or false, but source_url must not be set. If web_search fails or is rate-limited and the user hasn't stated values themselves, do not guess — call request_user_input instead. Pass units for every non-mass unit (個/杯/ml/...), other than basis_unit itself, this food might later be recorded with — record_meal_log rejects a unit it can't resolve to grams, so add every unit the user is likely to use (g/kg/mg need no entry). If a unit is missing later, use register_food_master_unit to add it instead of re-registering the food. Returns the registered name alongside food_master_id — pass that exact name as record_meal_log's food_name for this item.",
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<RegisterFoodMasterOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)
    return await service
      .register({
        name: parsed.value.name,
        nutrition: parsed.value.nutrition_per_basis,
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
        ...(parsed.value.basis_quantity === undefined
          ? {}
          : { basisQuantity: parsed.value.basis_quantity }),
        ...(parsed.value.basis_unit === undefined
          ? {}
          : { basisUnit: parsed.value.basis_unit }),
      })
      .map((master) => ({
        food_master_id: master.id,
        name: master.name,
        source: parsed.value.source,
        source_url: master.sourceUrl,
        nutrition_per_100g: parsed.value.nutrition_per_basis,
        basis_quantity: master.basisQuantity,
        basis_unit: master.basisUnit,
      }))
      .mapErr((e): ToolError => ({
        code: `food_master/${e.code}`,
        message: e.message,
        details: e.details,
      }))
  },
})
