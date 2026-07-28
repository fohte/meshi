import { AIMessage } from '@langchain/core/messages'
import { fakeModel } from 'langchain'

import { REQUEST_USER_INPUT_TOOL_NAME } from '#llm/agent/request-user-input-tool'

export interface ScriptedToolCall {
  readonly name: string
  readonly args: Record<string, unknown>
}

export interface ScriptedFinalResponse {
  readonly status: 'completed' | 'input_required'
  readonly message: string
}

let scriptedCallCounter = 0
const nextScriptedCallId = (): string => {
  scriptedCallCounter += 1
  return `call_${String(scriptedCallCounter)}`
}

// Chains one fakeModel().respondWithTools() round per scripted tool call,
// followed by a final AIMessage carrying `final.message` as its text — this
// is what createMeshiDomainAgent's ReAct loop actually drives the model
// through for one agent turn now that there is no mandatory
// structured-output tool. `input_required` is scripted by attaching a
// request_user_input tool call to that same final message, mirroring how
// the real model is asked to signal it (see system-prompt.ts). `final` is
// omitted for callers that never invoke the domain agent at all, so the
// model is built but never called.
export const scriptedDomainAgentModel = (
  toolCalls: ReadonlyArray<ScriptedToolCall>,
  final?: ScriptedFinalResponse,
) => {
  let model = fakeModel()
  for (const call of toolCalls) {
    model = model.respondWithTools([
      { name: call.name, args: call.args, id: nextScriptedCallId() },
    ])
  }
  if (final === undefined) return model
  return model.respond(
    new AIMessage({
      content: final.message,
      ...(final.status === 'input_required'
        ? {
            tool_calls: [
              {
                name: REQUEST_USER_INPUT_TOOL_NAME,
                args: {},
                id: nextScriptedCallId(),
                type: 'tool_call',
              },
            ],
          }
        : {}),
    }),
  )
}
