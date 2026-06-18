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

export interface ReplyFormatter {
  formatMealRecord(input: MealRecordSummaryInput): string
  formatMealHistory(input: MealHistorySummaryInput): string
  formatRecommend(input: RecommendSummaryInput): string
}

const passthroughFinalText = (
  finalText: string,
  error: OrchestratorError | null,
): string => (error !== null ? error.message : finalText)

export const createPassthroughReplyFormatter = (): ReplyFormatter => ({
  formatMealRecord(input) {
    return passthroughFinalText(input.finalText, input.error)
  },
  formatMealHistory(input) {
    return passthroughFinalText(input.finalText, input.error)
  },
  formatRecommend(input) {
    return passthroughFinalText(input.finalText, input.error)
  },
})

const NUTRITION_LABEL: ReadonlyArray<readonly [string, string]> = [
  ['energy_kcal', 'kcal'],
  ['protein_g', 'P'],
  ['fat_g', 'F'],
  ['carbohydrate_g', 'C'],
]

const formatNumber = (n: number): string => {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(1)
}

const formatNutrition = (n: Readonly<Record<string, number>>): string => {
  const parts: string[] = []
  for (const [key, label] of NUTRITION_LABEL) {
    const v = n[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    parts.push(
      label === 'kcal'
        ? `${formatNumber(v)} kcal`
        : `${label} ${formatNumber(v)}g`,
    )
  }
  return parts.join(' / ')
}

const formatErrorReply = (error: OrchestratorError): string => {
  switch (error.kind) {
    case 'interpretation_failed':
      return [
        '画像を解釈できませんでした。',
        '明るい場所で撮り直すか、テキストで食事内容を入力してください。',
        `詳細: ${error.message}`,
      ].join('\n')
    case 'max_turns_exceeded':
      return [
        '処理が長くなったため中断しました。',
        '入力を分けるか、もう少し短い表現で試してください。',
      ].join('\n')
    case 'divergence_detected':
      return [
        '内部処理で同じ操作が繰り返されたため中断しました。',
        '入力を変えてもう一度試してください。',
      ].join('\n')
  }
}

const formatMealRecordTemplate = (input: MealRecordSummaryInput): string => {
  if (input.error) return formatErrorReply(input.error)

  if (input.recorded.length > 0) {
    const lines: string[] = []
    lines.push(`記録しました (${String(input.recorded.length)} 件)。`)
    for (const r of input.recorded) {
      const nutrition = formatNutrition(r.nutrition)
      const estimatedSuffix = r.isEstimated ? ' [推測値]' : ''
      const tail = nutrition === '' ? '' : `: ${nutrition}`
      lines.push(`- ${r.foodMasterId}${tail}${estimatedSuffix}`)
    }
    if (input.hasEstimatedValues) {
      lines.push('※ 推測値が含まれています。値は目安としてご確認ください。')
    }
    return lines.join('\n')
  }

  if (input.candidates.length > 0) {
    const lines: string[] = []
    lines.push(
      '食品を一意に特定できませんでした。次の候補から選んで、もう一度入力してください。',
    )
    for (const c of input.candidates) {
      const suffix = c.isEstimated ? ' (推測値)' : ''
      lines.push(`- ${c.name}${suffix}: ${c.reason}`)
    }
    return lines.join('\n')
  }

  const trimmed = input.finalText.trim()
  if (trimmed !== '') return trimmed
  return '記録できませんでした。食品名と量がわかる形でもう一度入力してください。'
}

const formatTotalsLine = (totals: Readonly<Record<string, number>>): string => {
  const formatted = formatNutrition(totals)
  return formatted === '' ? '合計: (該当データなし)' : `合計: ${formatted}`
}

const formatMealHistoryTemplate = (input: MealHistorySummaryInput): string => {
  if (input.error) return formatErrorReply(input.error)

  const aggregate = input.aggregate
  if (aggregate === null) {
    const trimmed = input.finalText.trim()
    if (trimmed !== '') return trimmed
    return '集計データが取得できませんでした。期間や条件を変えて試してください。'
  }

  const lines: string[] = []
  lines.push('集計結果:')
  lines.push(`- ${formatTotalsLine(aggregate.totals)}`)
  lines.push(`- 期間内の日数: ${String(aggregate.perDay.length)} 日`)
  lines.push(`- 記録件数: ${String(aggregate.entries.length)} 件`)
  if (aggregate.hasEstimatedValues) {
    lines.push(
      '※ 集計には推測値が含まれています。値は目安としてご確認ください。',
    )
  }
  return lines.join('\n')
}

const formatRecommendTemplate = (input: RecommendSummaryInput): string => {
  if (input.error) return formatErrorReply(input.error)
  const trimmed = input.finalText.trim()
  if (trimmed !== '') return trimmed
  return 'おすすめを提案できませんでした。条件を変えて試してください。'
}

export const createTemplateReplyFormatter = (): ReplyFormatter => ({
  formatMealRecord(input) {
    return formatMealRecordTemplate(input)
  },
  formatMealHistory(input) {
    return formatMealHistoryTemplate(input)
  },
  formatRecommend(input) {
    return formatRecommendTemplate(input)
  },
})
