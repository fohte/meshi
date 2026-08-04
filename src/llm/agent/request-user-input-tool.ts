import { tool } from 'langchain'
import { z } from 'zod'

export const REQUEST_USER_INPUT_TOOL_NAME = 'request_user_input'

// `question` duplicates the reply text this call accompanies (see
// system-prompt.ts) rather than relying on that text alone: derive-reply.ts
// falls back to this argument when a turn's AI message text comes back
// empty, so the question still reaches the user even if the model forgets
// to also write it into its reply text.
const inputSchema = z.object({
  question: z
    .string()
    .min(1)
    .describe(
      'The question to ask the user before you can proceed — the same text you wrote as your reply for this turn.',
    ),
})

// returnDirect ends the ReAct loop right after this tool executes (see
// LangChain's ReactAgent#createToolsRouter), so the model's own AIMessage —
// the one carrying both this tool call and the reply text in its `content`
// — stays the turn's last AI message. derive-reply.ts reads that message
// back out regardless of whether this tool was called at all, so forgetting
// to call it just leaves the turn's status as 'completed' instead of
// dropping the reply.
export const createRequestUserInputTool = () =>
  tool(() => Promise.resolve('ok'), {
    name: REQUEST_USER_INPUT_TOOL_NAME,
    description:
      'Call this in the same turn as your reply text when that reply asks the user a question you need answered before you can proceed (e.g. which candidate to pick). Pass that same question as the `question` argument too. Do not call this when the request is already fully handled.',
    schema: inputSchema,
    returnDirect: true,
  })
