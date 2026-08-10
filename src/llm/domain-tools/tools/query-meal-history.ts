import { z } from 'zod'

import { NUTRIENT_CODES } from '#db/seed/nutrient-definitions'
import type { MealHistoryService } from '#domain/meal-history/types'
import { MEAL_TYPES, type MealType } from '#domain/meal-log/types'
import { jstDateSchema } from '#lib/jst-date'
import { internalErr } from '#llm/domain-tools/internal-error'
import { parseToolInput } from '#llm/domain-tools/parse'
import {
  type DomainTool,
  err,
  ok,
  type Result,
  type ToolError,
} from '#llm/domain-tools/types'

const inputSchema = z.object({
  period_from: jstDateSchema,
  period_to: jstDateSchema,
  food_master_ids: z.array(z.string().min(1)).optional(),
  nutrient_codes: z.array(z.enum(NUTRIENT_CODES)).optional(),
})

const queryMealHistoryEntrySchema = z.object({
  meal_log_id: z.string(),
  food_master_id: z.string(),
  food_name: z.string(),
  eaten_date: z.string(),
  meal_type: z.enum(MEAL_TYPES),
  quantity: z.number(),
})

// Exported so callers reading this tool's result back out of a serialized
// form (e.g. the A2A path re-parsing it from a LangChain ToolMessage, see
// agent-executor.ts) can validate it at that boundary instead of casting.
export const queryMealHistoryOutputSchema = z.object({
  totals: z.record(z.string(), z.number()),
  per_day: z.array(
    z.object({ date: z.string(), totals: z.record(z.string(), z.number()) }),
  ),
  entries: z.array(queryMealHistoryEntrySchema),
  has_estimated_values: z.boolean(),
})

export type QueryMealHistoryEntry = z.infer<typeof queryMealHistoryEntrySchema>
export type QueryMealHistoryOutput = z.infer<
  typeof queryMealHistoryOutputSchema
>

// The snake_case-to-camelCase field mapping every consumer of this tool's
// wire-format entries needs (the A2A path's itemized rendering, the
// orchestrator's MealHistoryAggregateSnapshot) — kept here as the single
// place that knows this tool's output field names, rather than duplicated
// per caller.
export const toMealHistoryEntryFields = (
  entry: QueryMealHistoryEntry,
): {
  readonly foodMasterId: string
  readonly foodName: string
  readonly eatenDate: string
  readonly mealType: MealType
  readonly quantity: number
} => ({
  foodMasterId: entry.food_master_id,
  foodName: entry.food_name,
  eatenDate: entry.eaten_date,
  mealType: entry.meal_type,
  quantity: entry.quantity,
})

export const createQueryMealHistoryTool = (
  service: MealHistoryService,
): DomainTool => ({
  name: 'query_meal_history',
  description:
    'Aggregate meal_logs over a half-open [period_from, period_to) window of JST calendar dates. Returns per-nutrient totals, per-day breakdown, raw entries, and whether any aggregated values come from estimated food_master rows.',
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<QueryMealHistoryOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)

    const queryResult = await service.query({
      periodFrom: parsed.value.period_from,
      periodTo: parsed.value.period_to,
      ...(parsed.value.food_master_ids === undefined
        ? {}
        : { foodFilter: parsed.value.food_master_ids }),
      ...(parsed.value.nutrient_codes === undefined
        ? {}
        : { nutrientCodes: parsed.value.nutrient_codes }),
    })
    if (queryResult.isErr()) return internalErr(queryResult.error)

    const aggregate = queryResult.value
    return ok({
      totals: aggregate.totals,
      per_day: aggregate.perDay.map((d) => ({
        date: d.date,
        totals: d.totals,
      })),
      entries: aggregate.entries.map((entry) => ({
        meal_log_id: entry.id,
        food_master_id: entry.foodMasterId,
        food_name: entry.foodName,
        eaten_date: entry.eatenDate,
        meal_type: entry.mealType,
        quantity: entry.quantity,
      })),
      has_estimated_values: aggregate.hasEstimatedValues,
    })
  },
})
