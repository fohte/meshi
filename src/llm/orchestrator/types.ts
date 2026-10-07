import type { SupportedImageMimeType } from '#adapters/image/image-types'

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

type OrchestratorErrorKind =
  | 'deadline_exceeded'
  | 'max_turns_exceeded'
  | 'divergence_detected'
  | 'interpretation_failed'
  | 'item_conversation_failed'

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

export interface RecommendResult {
  readonly summaryText: string
  readonly error: OrchestratorError | null
}

export interface ConversationOrchestrator {
  recordFromText(
    input: RecordFromTextInput,
    signal?: AbortSignal,
  ): Promise<MealRecordResult>
  recordFromImage(
    input: RecordFromImageInput,
    signal?: AbortSignal,
  ): Promise<MealRecordResult>
  recommendMeal(
    input: RecommendInput,
    signal?: AbortSignal,
  ): Promise<RecommendResult>
}
