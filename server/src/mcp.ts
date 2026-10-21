import { McpServer } from '@modelcontextprotocol/server'

import { type MeshiToolDeps, registerMeshiTools } from '#mcp-tools'

const MCP_SERVER_NAME = 'meshi'
const MCP_SERVER_VERSION = '0.0.0'

export const createMcpServer = (deps: MeshiToolDeps): McpServer => {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  )
  registerMeshiTools(server, deps)
  return server
}
