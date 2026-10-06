import type { LlmToolSchema } from '#adapters/llm/types'
import type { DomainToolsRegistry } from '#llm/domain-tools/registry'
import type { DomainTool } from '#llm/domain-tools/types'

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
