import { fakeModel } from 'langchain'

export interface ScriptedToolCall {
  readonly name: string
  readonly args: Record<string, unknown>
}

export interface ScriptedFinalResponse {
  readonly status: 'completed' | 'input_required' | 'error'
  readonly message: string
}

let scriptedCallCounter = 0
const nextScriptedCallId = (): string => {
  scriptedCallCounter += 1
  return `call_${String(scriptedCallCounter)}`
}

// Chains one fakeModel().respondWithTools() round per scripted tool call,
// followed by a final round calling the toolStrategy-synthesized
// meshi_agent_response tool — this is what createMeshiDomainAgent's ReAct
// loop actually drives the model through for one agent turn. `final` is
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
  return model.respondWithTools([
    { name: 'meshi_agent_response', args: final, id: nextScriptedCallId() },
  ])
}
