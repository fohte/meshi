import { randomUUID } from 'node:crypto'

import { HumanMessage } from '@langchain/core/messages'
import { fakeModel } from 'langchain'
import { expect, it } from 'vitest'

import { createMeshiCheckpointer } from '@/llm/agent/checkpointer'
import { createMeshiDomainAgent } from '@/llm/agent/domain-agent'
import type { DomainToolsRegistry } from '@/llm/domain-tools/registry'
import { describeIfDb, TEST_DATABASE_URL } from '@/test/db'

const emptyRegistry: DomainToolsRegistry = {
  list: () => [],
  get: () => undefined,
  toLlmSchemas: () => [],
  executeToolUse: () => {
    throw new Error('not used in this test')
  },
}

describeIfDb('createMeshiCheckpointer', () => {
  // PostgresSaver manages its own pg.Pool (a different driver than the
  // postgres-js pool setupTx()/setupDrizzleTx() reserve a connection from),
  // so it cannot share a per-test transaction with those helpers. Isolation
  // instead comes from a unique thread_id per test plus an explicit
  // deleteThread() cleanup of only the rows this test wrote.
  it('persists conversation state across independent checkpointer instances for the same thread', async () => {
    if (TEST_DATABASE_URL === undefined) {
      throw new Error('TEST_DATABASE_URL is not set')
    }
    const threadId = randomUUID()

    // Cleanup lives in this outer finally (rather than only around the
    // second checkpointer below) so a failure inside the first agent's
    // invoke still deletes the row this test wrote.
    try {
      const checkpointer1 = createMeshiCheckpointer(TEST_DATABASE_URL)
      try {
        const agent1 = createMeshiDomainAgent({
          model: fakeModel().respondWithTools([
            {
              name: 'meshi_agent_response',
              args: { status: 'completed', message: 'first turn done' },
              id: 'call_1',
            },
          ]),
          registry: emptyRegistry,
          checkpointer: checkpointer1,
        })
        await agent1.invoke(
          { messages: [{ role: 'user', content: 'first message' }] },
          { configurable: { thread_id: threadId } },
        )
      } finally {
        await checkpointer1.end()
      }

      const checkpointer2 = createMeshiCheckpointer(TEST_DATABASE_URL)
      try {
        const agent2 = createMeshiDomainAgent({
          model: fakeModel().respondWithTools([
            {
              name: 'meshi_agent_response',
              args: { status: 'completed', message: 'second turn done' },
              id: 'call_2',
            },
          ]),
          registry: emptyRegistry,
          checkpointer: checkpointer2,
        })
        const result = await agent2.invoke(
          { messages: [{ role: 'user', content: 'second message' }] },
          { configurable: { thread_id: threadId } },
        )

        const humanTexts = result.messages
          .filter((m) => HumanMessage.isInstance(m))
          .map((m) => m.text)
        expect(humanTexts).toEqual(['first message', 'second message'])
      } finally {
        await checkpointer2.end()
      }
    } finally {
      const cleanup = createMeshiCheckpointer(TEST_DATABASE_URL)
      try {
        await cleanup.deleteThread(threadId)
      } finally {
        await cleanup.end()
      }
    }
  })
})
