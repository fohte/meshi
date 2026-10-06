import type { DomainToolsRegistry } from '#llm/domain-tools/registry'
import type { DomainToolName } from '#llm/domain-tools/types'
import { deriveDomainToolsRegistry } from '#llm/orchestrator/derived-tool-registry'

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
