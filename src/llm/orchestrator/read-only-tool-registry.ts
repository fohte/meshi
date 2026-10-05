import type { LlmToolSchema } from '#adapters/llm/types'
import type { DomainToolsRegistry } from '#llm/domain-tools/registry'
import type { DomainTool, DomainToolName } from '#llm/domain-tools/types'

// Derived registries expose their selected tools through list() and get().
// createMeshiDomainAgent should not call executeToolUse() directly; rejecting
// it here makes an unexpected call fail instead of bypassing the derivation.
export const deriveDomainToolsRegistry = (
  tools: ReadonlyArray<DomainTool>,
  originName: string,
  toLlmSchemas: () => ReadonlyArray<LlmToolSchema>,
): DomainToolsRegistry => {
  const byName = new Map<string, DomainTool>(
    tools.map((tool) => [tool.name, tool]),
  )
  return {
    list: () => tools,
    get: (name) => byName.get(name),
    toLlmSchemas,
    executeToolUse: () =>
      Promise.reject(
        new Error(
          `executeToolUse is not observed by ${originName}; createMeshiDomainAgent must not call it`,
        ),
      ),
  }
}

const READ_ONLY_TOOL_NAMES: ReadonlySet<DomainToolName> = new Set([
  'search_food_master',
  'query_meal_history',
  'get_user_profile',
  'web_search',
])

// query_meals / recommend_meal declare readOnlyHint: true on their MCP tool,
// so the agent turn behind them must never be able to reach a write tool.
export const restrictToReadOnly = (
  registry: DomainToolsRegistry,
): DomainToolsRegistry => {
  const tools = registry
    .list()
    .filter((tool) => READ_ONLY_TOOL_NAMES.has(tool.name))
  return deriveDomainToolsRegistry(tools, 'restrictToReadOnly', () =>
    tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  )
}
