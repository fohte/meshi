import { tool } from 'langchain'

import { toInternalToolError } from '@/llm/domain-tools/internal-error'
import type { DomainTool, ToolError } from '@/llm/domain-tools/types'

const safeStringify = (value: unknown): string | null => {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

// Same envelope as createDomainToolsRegistry's executeToolUse (registry.ts)
// and the orchestrator's encodeOk/encodeToolError (orchestrator.ts): each
// LLM integration surface in this repo encodes DomainTool results as plain
// JSON tool-message content rather than relying on a framework-specific
// error channel, so the wire format stays uniform across MCP and agent
// tool calls. Left as a third copy rather than extracted to a shared
// helper: doing so would mean editing registry.ts/orchestrator.ts, which
// are explicitly out of scope for this change.
const encodeOk = (value: unknown): string =>
  safeStringify(value) ??
  JSON.stringify({
    error: {
      code: 'internal_error',
      message: 'failed to serialize tool result',
    },
  })

const encodeError = (error: ToolError): string =>
  safeStringify({ error }) ??
  JSON.stringify({
    error: {
      code: 'internal_error',
      message: 'failed to serialize tool error',
    },
  })

export const toLangChainTool = (domainTool: DomainTool) =>
  tool(
    async (input: unknown): Promise<string> => {
      try {
        const result = await domainTool.execute(input)
        return result.match(encodeOk, encodeError)
      } catch (e) {
        return encodeError(toInternalToolError(e))
      }
    },
    {
      name: domainTool.name,
      description: domainTool.description,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- domainTool.inputSchema is produced by zod's z.toJSONSchema() (see e.g. record-meal-log.ts); it is a valid JSON Schema object, just not typed as langchain's internal JsonSchema7Type.
      schema: domainTool.inputSchema as never,
    },
  )

export const toLangChainTools = (
  domainTools: ReadonlyArray<DomainTool>,
): ReadonlyArray<ReturnType<typeof toLangChainTool>> =>
  domainTools.map(toLangChainTool)
