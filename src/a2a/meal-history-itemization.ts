import type { MealType } from '#domain/meal-log/types'
import { parseJson } from '#lib/json'
import {
  type AgentInvokeMessage,
  findTurnMessages,
} from '#llm/agent/derive-reply'
import {
  type QueryMealHistoryOutput,
  queryMealHistoryOutputSchema,
  toMealHistoryEntryFields,
} from '#llm/domain-tools/tools/query-meal-history'

const QUERY_MEAL_HISTORY_TOOL_NAME = 'query_meal_history'

const MEAL_TYPE_LABEL: Readonly<Record<MealType, string>> = {
  breakfast: '朝食',
  lunch: '昼食',
  dinner: '夕食',
  snack: '間食',
}

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return String(value)
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(1)
}

const formatMealHistoryEntries = (
  entries: ReadonlyArray<ReturnType<typeof toMealHistoryEntryFields>>,
): string => {
  const lines = [`明細 (${String(entries.length)} 件):`]
  for (const entry of entries) {
    const quantity = formatNumber(entry.quantity)
    lines.push(
      `- ${entry.eatenDate} ${MEAL_TYPE_LABEL[entry.mealType]} ${entry.foodName} × ${quantity}`,
    )
  }
  return lines.join('\n')
}

// Finds the most recent query_meal_history tool result produced after the
// turn's own human message — not just anywhere in the thread — so a history
// query from an earlier turn on the same context can't leak its itemized
// entries into a later, unrelated turn's response (e.g. recording a meal).
export const extractLatestMealHistoryOutput = (
  messages: ReadonlyArray<AgentInvokeMessage> | undefined,
): QueryMealHistoryOutput | null => {
  const turnMessages = findTurnMessages(messages)
  for (let i = turnMessages.length - 1; i >= 0; i -= 1) {
    const message = turnMessages[i]
    if (
      message === undefined ||
      message.getType() !== 'tool' ||
      message.name !== QUERY_MEAL_HISTORY_TOOL_NAME ||
      typeof message.content !== 'string'
    ) {
      continue
    }
    const json = parseJson(message.content)
    if (json.isErr()) continue
    const parsed = queryMealHistoryOutputSchema.safeParse(json.value)
    if (parsed.success) return parsed.data
  }
  return null
}

// Appends a deterministic, code-rendered itemization of this turn's
// query_meal_history entries after the LLM's own message — the LLM's text
// stays free-form (it may still summarize or ask a follow-up), but the
// actual list of what was eaten never depends on the LLM choosing to
// enumerate it faithfully.
export const withItemizedMealHistory = (
  message: string,
  output: QueryMealHistoryOutput | null,
): string => {
  if (output === null || output.entries.length === 0) return message
  return `${message}\n\n${formatMealHistoryEntries(output.entries.map(toMealHistoryEntryFields))}`
}
