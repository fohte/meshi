import type {
  FoodCandidate,
  MealHistoryAggregateSnapshot,
  OrchestratorError,
  RecordedMeal,
} from '@/llm/orchestrator/types'

export interface MealRecordSummaryInput {
  readonly recorded: ReadonlyArray<RecordedMeal>
  readonly candidates: ReadonlyArray<FoodCandidate>
  readonly hasEstimatedValues: boolean
  readonly finalText: string
  readonly error: OrchestratorError | null
}

export interface MealHistorySummaryInput {
  readonly aggregate: MealHistoryAggregateSnapshot | null
  readonly finalText: string
  readonly error: OrchestratorError | null
}

export interface RecommendSummaryInput {
  readonly finalText: string
  readonly error: OrchestratorError | null
}

// ReplyFormatter generates user-facing summary text from structured results.
// The default implementation here is a thin passthrough; the templated
// implementation (task 5.2) will replace it without changing the interface.
export interface ReplyFormatter {
  formatMealRecord(input: MealRecordSummaryInput): string
  formatMealHistory(input: MealHistorySummaryInput): string
  formatRecommend(input: RecommendSummaryInput): string
}

const passthroughFinalText = (
  finalText: string,
  fallback: string,
  error: OrchestratorError | null,
): string => {
  if (error !== null) {
    return error.message
  }
  if (finalText !== '') {
    return finalText
  }
  return fallback
}

export const createPassthroughReplyFormatter = (): ReplyFormatter => ({
  formatMealRecord(input) {
    return passthroughFinalText(input.finalText, '', input.error)
  },
  formatMealHistory(input) {
    return passthroughFinalText(input.finalText, '', input.error)
  },
  formatRecommend(input) {
    return passthroughFinalText(input.finalText, '', input.error)
  },
})
