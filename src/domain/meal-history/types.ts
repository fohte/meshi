export type NutrientCode = string

export type NutritionMap = Readonly<Record<NutrientCode, number>>

export interface QueryMealHistoryInput {
  readonly periodFrom: Date
  readonly periodTo: Date
  readonly foodFilter?: ReadonlyArray<string>
  readonly nutrientCodes?: ReadonlyArray<NutrientCode>
}

export interface MealLogEntry {
  readonly id: string
  readonly foodMasterId: string
  readonly eatenAt: Date
  readonly quantity: number
  readonly unit: string
  readonly note: string | null
}

export interface MealHistoryDayTotals {
  readonly date: string
  readonly totals: NutritionMap
}

export interface MealHistoryAggregate {
  readonly totals: NutritionMap
  readonly perDay: ReadonlyArray<MealHistoryDayTotals>
  readonly entries: ReadonlyArray<MealLogEntry>
  readonly hasEstimatedValues: boolean
}

export interface MealHistoryService {
  query(input: QueryMealHistoryInput): Promise<MealHistoryAggregate>
}
