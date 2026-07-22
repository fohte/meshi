import { z } from 'zod'

import type { MealHistoryService } from '@/domain/meal-history/types'
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

export interface QueryMealHistoryEntry {
  readonly meal_log_id: string
  readonly food_master_id: string
  readonly eaten_at_iso: string
  readonly quantity: number
  readonly unit: string
  readonly note: string | null
}

export interface QueryMealHistoryOutput {
  readonly totals: Readonly<Record<string, number>>
  readonly per_day: ReadonlyArray<{
    readonly date: string
    readonly totals: Readonly<Record<string, number>>
  }>
  readonly entries: ReadonlyArray<QueryMealHistoryEntry>
  readonly has_estimated_values: boolean
}

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
        quantity: entry.quantity,
        unit: entry.unit,
        note: entry.note,
      })),
      has_estimated_values: aggregate.hasEstimatedValues,
    })
  },
})
