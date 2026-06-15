import {
  FutureEatenAtError,
  InvalidQuantityError,
} from '@/domain/meal-log/errors'
import type { MealLogRepository } from '@/domain/meal-log/meal-log-repository'
import type {
  FoodMasterRef,
  MealLogResult,
  MealLogRow,
  NutritionMap,
  RecordMealLogInput,
} from '@/domain/meal-log/types'

export interface MealLogService {
  record(input: RecordMealLogInput): Promise<MealLogResult>
  getById(id: string): Promise<MealLogResult | null>
}

export interface MealLogServiceDeps {
  readonly repository: MealLogRepository
  readonly idGenerator: () => string
  readonly now: () => Date
}

export const createMealLogService = (
  deps: MealLogServiceDeps,
): MealLogService => ({
  async record(input) {
    if (input.eatenAt.getTime() > deps.now().getTime()) {
      throw new FutureEatenAtError(input.eatenAt)
    }
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw new InvalidQuantityError(input.quantity)
    }
    const food = await deps.repository.findFoodMaster(input.foodMasterId)
    const log = await deps.repository.insertMealLog({
      id: deps.idGenerator(),
      foodMasterId: input.foodMasterId,
      eatenAt: input.eatenAt,
      quantity: input.quantity,
      unit: input.unit,
      note: input.note ?? null,
    })
    return buildResult(log, food)
  },
  async getById(id) {
    const found = await deps.repository.findMealLogById(id)
    if (found === null) return null
    return buildResult(found.log, found.food)
  },
})

const buildResult = (log: MealLogRow, food: FoodMasterRef): MealLogResult => ({
  ...log,
  nutrition: scaleNutrition(food.nutritionPer100g, log.quantity, log.unit),
  isEstimated: food.isEstimated,
})

// food_master nutrient values are stored per 100g. When the meal log is in grams we
// scale linearly; for non-gram units (杯, 個, etc.) we treat the per-100g values as
// per-1-serving so quantity becomes a direct multiplier.
const scaleNutrition = (
  per100g: NutritionMap,
  quantity: number,
  unit: string,
): NutritionMap => {
  // Inputs come from LLM-driven free text so accept 'G' / ' g ' as the gram unit
  // — otherwise we'd silently scale by ×100 instead of ×(quantity/100).
  const multiplier =
    unit.trim().toLowerCase() === 'g' ? quantity / 100 : quantity
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(per100g)) {
    out[key] = value * multiplier
  }
  return out
}
