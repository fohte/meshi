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
import { formatMealHistoryEntries } from '#llm/orchestrator/reply-formatter'

const QUERY_MEAL_HISTORY_TOOL_NAME = 'query_meal_history'

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
