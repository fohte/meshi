import type { SupportedImageMimeType } from '@/adapters/image/image-interpreter'

export interface RecordFromTextInput {
  readonly text: string
  readonly occurredAt?: Date
  readonly timezone?: string
}

export interface RecordFromImageInput {
  readonly image: {
    readonly mimeType: SupportedImageMimeType
    readonly base64: string
  }
  readonly hintText?: string
  readonly occurredAt?: Date
  readonly timezone?: string
}

export interface QueryMealsInput {
  readonly query: string
  readonly periodFrom?: Date
  readonly periodTo?: Date
  readonly timezone?: string
}

export interface RecommendInput {
  readonly conditions?: string
  readonly timezone?: string
}

export interface RecordedMeal {
  readonly mealLogId: string
  readonly foodMasterId: string
  readonly nutrition: Readonly<Record<string, number>>
  readonly isEstimated: boolean
}

export interface FoodCandidate {
  readonly foodMasterId: string | null
  readonly compositionCode: string | null
  readonly name: string
  readonly isEstimated: boolean
  readonly score: number
  readonly reason: string
}

export interface MealHistoryAggregateSnapshot {
  readonly totals: Readonly<Record<string, number>>
  readonly perDay: ReadonlyArray<{
    readonly date: string
    readonly totals: Readonly<Record<string, number>>
  }>
  readonly entries: ReadonlyArray<{
    readonly mealLogId: string
    readonly foodMasterId: string
    readonly eatenAtIso: string
    readonly quantity: number
    readonly unit: string
    readonly note: string | null
  }>
  readonly hasEstimatedValues: boolean
}

export type OrchestratorErrorKind =
  | 'max_turns_exceeded'
  | 'divergence_detected'
  | 'interpretation_failed'

export interface OrchestratorError {
  readonly kind: OrchestratorErrorKind
  readonly message: string
}

export interface MealRecordResult {
  readonly recorded: ReadonlyArray<RecordedMeal>
  readonly candidates: ReadonlyArray<FoodCandidate>
  readonly hasEstimatedValues: boolean
  readonly summaryText: string
  readonly error: OrchestratorError | null
}

export interface MealHistoryResult {
  readonly aggregate: MealHistoryAggregateSnapshot | null
  readonly hasEstimatedValues: boolean
  readonly summaryText: string
  readonly error: OrchestratorError | null
}

export interface RecommendResult {
  readonly summaryText: string
  readonly error: OrchestratorError | null
}

export interface ConversationOrchestrator {
  recordFromText(input: RecordFromTextInput): Promise<MealRecordResult>
  recordFromImage(input: RecordFromImageInput): Promise<MealRecordResult>
  queryMeals(input: QueryMealsInput): Promise<MealHistoryResult>
  recommendMeal(input: RecommendInput): Promise<RecommendResult>
}
