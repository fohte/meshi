import { tool } from 'langchain'
import { z } from 'zod'

export const REQUEST_USER_INPUT_TOOL_NAME = 'request_user_input'

// No arguments: the reply text this call accompanies already carries the
// question (see system-prompt.ts and derive-reply.ts), so there is nothing
// left to pass through tool args.
const inputSchema = z.object({})

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
      'Call this in the same turn as your reply text when that reply asks the user a question you need answered before you can proceed (e.g. which candidate to pick). Do not call this when the request is already fully handled.',
    schema: inputSchema,
    returnDirect: true,
  })
