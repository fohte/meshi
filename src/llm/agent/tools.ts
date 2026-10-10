import { tool } from 'langchain'
import { Result } from 'neverthrow'

import { toInternalToolError } from '#llm/domain-tools/internal-error'
import type { DomainTool, ToolError } from '#llm/domain-tools/types'

const stringify = Result.fromThrowable((value: unknown): string =>
  JSON.stringify(value),
)

const safeStringify = (value: unknown): string | null =>
  stringify(value).unwrapOr(null)

// Keep the tool-result JSON envelope consistent with
// createDomainToolsRegistry.executeToolUse for callers using either path.
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
      // eslint-disable-next-line no-restricted-syntax -- runs inside LangChain's tool() executor, which expects a resolved string or a thrown rejection; domainTool.execute()'s Result is already handled via .match() below, so this only guards a genuinely unexpected throw before it reaches LangChain unhandled
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
