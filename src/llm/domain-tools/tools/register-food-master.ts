import { z } from 'zod'

import { NUTRIENT_CODES } from '#db/seed/nutrient-definitions'
import type { FoodMasterService } from '#domain/food-master/service'
import {
  hasDuplicateAfterTrim,
  INVALID_SOURCE_COMBINATION_MESSAGE,
  isEmptyNutrition,
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
const inputSchema = z
  .object({
    name: z.string().min(1).regex(NON_BLANK),
    aliases: z.array(z.string().min(1).regex(NON_BLANK)).optional(),
    nutrition_per_basis: z.partialRecord(
      z.enum(NUTRIENT_CODES),
      z.number().nonnegative(),
    ),
    source: z.enum(['web_search', 'user_input']),
    is_estimated: z.boolean(),
    source_url: z
      .url()
      .refine((url) => !/[\r\n]/.test(url), {
        message: 'source_url must not contain control characters',
      })
      .optional(),
    confirmed_distinct_from_master_ids: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => !isEmptyNutrition(v.nutrition_per_basis), {
    message: 'nutrition_per_basis must include at least one nutrient value',
    path: ['nutrition_per_basis'],
  })
  .refine((v) => !isInvalidSourceCombination(v.source, v.is_estimated), {
    message: INVALID_SOURCE_COMBINATION_MESSAGE,
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
  // Field named nutrition_per_100g for src/a2a/food-master-disclosure.ts,
  // which parses this exact key from the tool's JSON result. The value is
  // nutrition per one of this food, as registered — not necessarily per
  // 100g.
  readonly nutrition_per_100g: Readonly<Record<string, number>>
}

export const createRegisterFoodMasterTool = (
  service: FoodMasterService,
): DomainTool => ({
  name: 'register_food_master',
  description:
    "Register a new food_master row, source=web_search or source=user_input only — never fabricate nutrition values from your own general knowledge. nutrition_per_basis must include at least one nutrient value; a food with no usable evidence at all belongs to request_user_input, not an empty registration. nutrition_per_basis is nutrition for one of this food, however many grams, ml, or servings 'one' of it actually is — register it for whatever single unit, serving, or item the evidence itself describes (one can, one bowl, one slice, per 100g, ...) at face value, never converted or estimated to force a per-100g figure. If the food is backed by a food_compositions row (search_food_master returned a candidate with a composition_code), use register_food_master_from_composition instead, which copies the composition's own per-100g nutrition verbatim. name must identify the product on its own, without a reader needing source_url to tell it apart from a similar product: whenever the food has an identifiable manufacturer, store, or restaurant/chain, put that brand at the front of name, even if the source itself never states it in the product name — an official manufacturer or chain page routinely omits its own brand from the product title because the site itself already supplies that context (e.g. an official McDonald's page naming a menu item without the word McDonald's anywhere in its name). Leave the brand off only for food that genuinely has none, such as a home-cooked dish or a raw ingredient. source=web_search requires is_estimated=false, source_url set to the page you found the values on, and the rest of name — everything after the brand — copied verbatim from that page's own product/menu name, including qualifiers like a seasonal or edition name, never paraphrased, abbreviated, or shortened by dropping a word. source=web_search asserts that source_url itself confirms these exact values for this specific product and size — an aggregator, calculator, or blog page, or a page you can't confirm matches this product and size, does not meet that bar; treat it the same as web_search finding nothing, and either search again or call request_user_input. source=user_input is for values the user themselves stated in their message; is_estimated may be true or false, but source_url must not be set. If web_search fails or is rate-limited and the user hasn't stated values themselves, do not guess — call request_user_input instead. If register_food_master rejects a call for is_estimated=true combined with source=web_search, that means your own evidence wasn't solid enough — do not resend the same call with is_estimated=false to get past the error; call request_user_input instead. Before inserting, this tool checks name against every existing food_master's name and fails with food_master/similar_name_exists if one looks like a plausible match for the same product — the error lists each candidate's food_master_id, name, and score. On that error: reuse an existing candidate's food_master_id instead of registering (via record_meal_log or register_food_master_from_composition), retry web_search with a more specific query if you're not actually sure this is a new product, ask the user to disambiguate, or — only once you've genuinely confirmed via evidence that this is a different product from every listed candidate — retry this same call unchanged except for confirmed_distinct_from_master_ids listing exactly those candidates' food_master_id values. Returns the registered name alongside food_master_id — pass that exact name as record_meal_log's food_name for this item.",
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<RegisterFoodMasterOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)

    // ponytail: this check and the register() call below aren't in one
    // transaction, so two concurrent registrations of near-duplicate names
    // can both pass it — food_masters_name_key (exact match only) is the
    // only hard backstop for that race. Acceptable for a bot that processes
    // one conversation at a time; serialize both calls in one transaction if
    // that changes.
    const similar = await service.findSimilarNames(parsed.value.name)
    if (similar.isErr()) {
      return err({
        code: `food_master/${similar.error.code}`,
        message: similar.error.message,
        details: similar.error.details,
      })
    }
    const acknowledged = new Set(
      parsed.value.confirmed_distinct_from_master_ids ?? [],
    )
    const blocking = similar.value.filter(
      (c) => !acknowledged.has(c.foodMasterId),
    )
    if (blocking.length > 0) {
      return err({
        code: 'food_master/similar_name_exists',
        message:
          'existing food_master(s) with a similar name were found; reuse one of them if it is the same product, gather stronger evidence and retry if unsure, ask the user to disambiguate, or retry with confirmed_distinct_from_master_ids listing exactly these food_master_id values once you have verified this is a different product',
        details: {
          candidates: blocking.map((c) => ({
            food_master_id: c.foodMasterId,
            name: c.name,
            score: c.score,
          })),
        },
      })
    }

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
      })
      .map((master) => ({
        food_master_id: master.id,
        name: master.name,
        source: parsed.value.source,
        source_url: master.sourceUrl,
        nutrition_per_100g: parsed.value.nutrition_per_basis,
      }))
      .mapErr((e): ToolError => ({
        code: `food_master/${e.code}`,
        message: e.message,
        details: e.details,
      }))
  },
})
