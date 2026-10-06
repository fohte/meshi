import { randomUUID } from 'node:crypto'

import type { Message } from '@a2a-js/sdk'

export const buildAgentMessage = (
  taskId: string,
  contextId: string,
  text: string,
): Message => ({
  kind: 'message',
  role: 'agent',
  messageId: randomUUID(),
  parts: [{ kind: 'text', text }],
  taskId,
  contextId,
})
