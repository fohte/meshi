import { z } from 'zod'

import type { MealHistoryService } from '@/domain/meal-history/types'
import type { MealType } from '@/domain/meal-log/types'
import { internalErr } from '@/llm/domain-tools/internal-error'
import { parseToolInput } from '@/llm/domain-tools/parse'
import {
  type DomainTool,
  err,
  ok,
  type Result,
  type ToolError,
} from '@/llm/domain-tools/types'

const inputSchema = z.object({
  period_from_iso: z.iso.datetime({ offset: true }),
  period_to_iso: z.iso.datetime({ offset: true }),
  food_master_ids: z.array(z.string().min(1)).optional(),
  nutrient_codes: z.array(z.string().min(1)).optional(),
})

const queryMealHistoryEntrySchema = z.object({
  meal_log_id: z.string(),
  food_master_id: z.string(),
  eaten_at_iso: z.string(),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  quantity: z.number(),
  unit: z.string(),
  note: z.string().nullable(),
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
  readonly eatenAtIso: string
  readonly mealType: MealType
  readonly quantity: number
  readonly unit: string
  readonly note: string | null
} => ({
  foodMasterId: entry.food_master_id,
  eatenAtIso: entry.eaten_at_iso,
  mealType: entry.meal_type,
  quantity: entry.quantity,
  unit: entry.unit,
  note: entry.note,
})

export const createQueryMealHistoryTool = (
  service: MealHistoryService,
): DomainTool => ({
  name: 'query_meal_history',
  description:
    'Aggregate meal_logs over a half-open [period_from_iso, period_to_iso) window. Returns per-nutrient totals, per-day breakdown, raw entries, and whether any aggregated values come from estimated food_master rows.',
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<QueryMealHistoryOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)

    const queryResult = await service.query({
      periodFrom: new Date(parsed.value.period_from_iso),
      periodTo: new Date(parsed.value.period_to_iso),
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
        eaten_at_iso: entry.eatenAt.toISOString(),
        meal_type: entry.mealType,
        quantity: entry.quantity,
        unit: entry.unit,
        note: entry.note,
      })),
      has_estimated_values: aggregate.hasEstimatedValues,
    })
  },
})
