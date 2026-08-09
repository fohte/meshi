import { z } from 'zod'

import type { FoodMasterService } from '#domain/food-master/service'
import { parseToolInput } from '#llm/domain-tools/parse'
import {
  type DomainTool,
  err,
  type Result,
  type ToolError,
} from '#llm/domain-tools/types'

const inputSchema = z.object({
  survivor_food_master_id: z.string().min(1),
  loser_food_master_id: z.string().min(1),
  // io: 'input' below keeps this optional pre-parse — see the same note on
  // search_food_master's `limit`.
  dry_run: z.boolean().optional().default(true),
})

export interface MergeFoodMasterOutput {
  readonly survivor_food_master_id: string
  readonly loser_food_master_id: string
  readonly applied: boolean
  readonly moved_aliases: ReadonlyArray<string>
  readonly name_moved_as_alias: string | null
  readonly moved_units: ReadonlyArray<{
    readonly unit: string
    readonly grams_per_unit: number
  }>
  readonly discarded_units: ReadonlyArray<{
    readonly unit: string
    readonly grams_per_unit: number
  }>
  readonly discarded_nutrition: Readonly<Record<string, number>>
  readonly moved_meal_log_count: number
}

export const createMergeFoodMasterTool = (
  service: FoodMasterService,
): DomainTool => ({
  name: 'merge_food_master',
  description:
    "Merge two food_master rows that are actually the same food into one — e.g. the user says \"xとyを統合して\", or you notice two entries clearly describe the same product. You choose which id is survivor_food_master_id (kept) and which is loser_food_master_id (deleted); pick the one with the more trustworthy or complete data — this tool never decides that automatically. On any conflict the survivor always wins: a loser unit whose unit name the survivor already defines (even with a different grams_per_unit) is discarded, and the loser's entire nutrition is always discarded (nutrients are never moved). Everything else moves to the survivor: the loser's aliases, the loser's meal_logs, the loser's name itself (added as a new alias on the survivor, unless that exact string is already an alias elsewhere), and any loser unit the survivor doesn't already define. dry_run defaults to true and performs no writes — it returns the exact same result shape a live run would (what would move, what would be discarded), so show that to the user before proceeding. Only call this again with dry_run=false after the user has reviewed the dry-run output and confirmed the merge — this cannot be undone.",
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<MergeFoodMasterOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)

    return await service
      .merge(
        parsed.value.survivor_food_master_id,
        parsed.value.loser_food_master_id,
        parsed.value.dry_run,
      )
      .map((result) => ({
        survivor_food_master_id: result.survivorId,
        loser_food_master_id: result.loserId,
        applied: result.applied,
        moved_aliases: result.movedAliases,
        name_moved_as_alias: result.nameMovedAsAlias,
        moved_units: result.movedUnits.map((u) => ({
          unit: u.unit,
          grams_per_unit: u.gramsPerUnit,
        })),
        discarded_units: result.discardedUnits.map((u) => ({
          unit: u.unit,
          grams_per_unit: u.gramsPerUnit,
        })),
        discarded_nutrition: result.discardedNutrition,
        moved_meal_log_count: result.movedMealLogCount,
      }))
      .mapErr((e): ToolError => ({
        code: `food_master/${e.code}`,
        message: e.message,
        details: e.details,
      }))
  },
})
