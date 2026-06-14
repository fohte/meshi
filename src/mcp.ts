import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

export const MCP_SERVER_NAME = 'meshi'
export const MCP_SERVER_VERSION = '0.0.0'

export const createMcpServer = (): McpServer => {
  return new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  )
}
