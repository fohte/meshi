import { randomUUID } from 'node:crypto'

import type { AgentCard, Message, Task } from '@a2a-js/sdk'
import type { Client } from '@a2a-js/sdk/client'
import { ClientFactory, JsonRpcTransportFactory } from '@a2a-js/sdk/client'
import { DefaultRequestHandler } from '@a2a-js/sdk/server'
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { fakeModel } from 'langchain'
import { okAsync } from 'neverthrow'
import { expect, it } from 'vitest'

import { createMeshiAgentCard } from '@/a2a/agent-card'
import { createMeshiAgentExecutor } from '@/a2a/agent-executor'
import { createPostgresTaskStore } from '@/a2a/postgres-task-store'
import { createDrizzleUserProfileRepository } from '@/adapters/db/drizzle-user-profile-repository'
import type { WebSearchClient } from '@/adapters/web-search/web-search-client'
import { createApp } from '@/app'
import type { Sql } from '@/db'
import {
  createFoodMasterRepository,
  createFoodMasterService,
} from '@/domain/food-master'
import { createDrizzleFoodMatcher } from '@/domain/food-matcher'
import { createMealHistoryService } from '@/domain/meal-history'
import { createDrizzleMealLogRepository } from '@/domain/meal-log/drizzle-meal-log-repository'
import { createMealLogService } from '@/domain/meal-log/meal-log-service'
import { createUserProfileService } from '@/domain/user-profile/user-profile-service'
import { createMeshiCheckpointer } from '@/llm/agent/checkpointer'
import { createMeshiDomainAgent } from '@/llm/agent/domain-agent'
import {
  createDomainToolsRegistry,
  type DomainToolsRegistry,
} from '@/llm/domain-tools'
import {
  describeIfDb,
  getTestSql,
  setupDrizzleTx,
  setupTx,
  TEST_DATABASE_URL,
} from '@/test/db'
import { seedFoodMaster } from '@/test/seed'

const AGENT_CARD_URL = 'http://localhost/a2a'
const NORMALIZED = 'NORMALIZED'

const stubWebSearchClient = (): WebSearchClient => ({
  search: () => okAsync({ snippets: [] }),
})

// Wires the real domain tools (record_meal_log, search_food_master, ...)
// against a per-test Postgres transaction, mirroring the harness in
// src/integration/meshi.integration.test.ts but without the MCP/orchestrator
// layer — the A2A path invokes createMeshiDomainAgent directly.
const buildRegistry = (tx: Sql): DomainToolsRegistry => {
  let mealLogIdCursor = 0
  const mealLogService = createMealLogService({
    repository: createDrizzleMealLogRepository(tx),
    idGenerator: () => {
      mealLogIdCursor += 1
      return `ml_a2a_test_${String(mealLogIdCursor).padStart(4, '0')}`
    },
    now: () => new Date('2026-06-12T22:00:00+09:00'),
  })
  const foodMasterRepository = createFoodMasterRepository(tx, {
    generateId: (prefix) => `${prefix}_a2a_test`,
    // The outer per-test transaction already provides atomicity; postgres-js
    // rejects a nested BEGIN inside it.
    wrapInTransaction: false,
  })
  return createDomainToolsRegistry({
    mealLogService,
    foodMasterService: createFoodMasterService(foodMasterRepository),
    foodMatcher: createDrizzleFoodMatcher(tx),
    mealHistoryService: createMealHistoryService(tx),
    userProfileService: createUserProfileService(
      createDrizzleUserProfileRepository(tx),
    ),
    webSearchClient: stubWebSearchClient(),
  })
}

// Builds one full A2A pipeline — client, Hono app, executor, task store —
// backed by the given registry/model/checkpointer. Called twice with fresh
// executor/agent/checkpointer instances sharing the same taskStoreTx proves
// state resumes from Postgres rather than from in-process memory.
const buildHarness = async (opts: {
  readonly registry: DomainToolsRegistry
  readonly model: ReturnType<typeof fakeModel>
  readonly checkpointer: PostgresSaver
  readonly taskStoreTx: Sql
}): Promise<Client> => {
  const domainAgent = createMeshiDomainAgent({
    model: opts.model,
    registry: opts.registry,
    checkpointer: opts.checkpointer,
  })
  const agentExecutor = createMeshiAgentExecutor({
    agent: domainAgent,
    // withAdvisoryLock needs a poolable connection (sql.reserve()), which a
    // tx-scoped connection from setupTx()/setupDrizzleTx() can't provide —
    // see the comment on createMeshiAgentExecutor's sql option.
    sql: getTestSql(),
  })
  const agentCard: AgentCard = createMeshiAgentCard({ url: AGENT_CARD_URL })
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    createPostgresTaskStore(opts.taskStoreTx),
    agentExecutor,
  )
  const app = createApp({ sql: getTestSql(), agentCard, requestHandler })
  const factory = new ClientFactory({
    transports: [
      new JsonRpcTransportFactory({
        fetchImpl: (input, init) => Promise.resolve(app.request(input, init)),
      }),
    ],
  })
  return factory.createFromAgentCard(agentCard)
}

const assertTaskResult = (result: Message | Task): Task => {
  if (result.kind !== 'task') {
    throw new Error(`expected a Task result, got: ${result.kind}`)
  }
  return result
}

const sendUserMessage = async (
  client: Client,
  text: string,
  opts: {
    readonly messageId: string
    readonly taskId?: string
    readonly contextId?: string
  },
): Promise<Task> =>
  assertTaskResult(
    await client.sendMessage({
      message: {
        kind: 'message',
        messageId: opts.messageId,
        role: 'user',
        parts: [{ kind: 'text', text }],
        ...(opts.taskId !== undefined ? { taskId: opts.taskId } : {}),
        ...(opts.contextId !== undefined ? { contextId: opts.contextId } : {}),
      },
    }),
  )

// Timestamps and the agent's random messageId are the only non-deterministic
// fields on a Task returned over the wire — normalize them so the full
// result can still be asserted with one toEqual(), matching the pattern
// already established in src/a2a/agent-executor.test.ts.
const normalizeTask = (task: Task): Task => ({
  ...task,
  status: {
    ...task.status,
    timestamp: NORMALIZED,
    ...(task.status.message !== undefined
      ? { message: { ...task.status.message, messageId: NORMALIZED } }
      : {}),
  },
  ...(task.history !== undefined
    ? {
        history: task.history.map((m) =>
          m.role === 'agent' ? { ...m, messageId: NORMALIZED } : m,
        ),
      }
    : {}),
})

const buildAgentMessage = (
  taskId: string,
  contextId: string,
  text: string,
): Message => ({
  kind: 'message',
  role: 'agent',
  messageId: NORMALIZED,
  parts: [{ kind: 'text', text }],
  taskId,
  contextId,
})

describeIfDb('A2A integration', () => {
  const getDomainTx = setupDrizzleTx()
  const getTaskStoreTx = setupTx()

  it('records a meal via A2A message/send end-to-end and reaches a completed task', async () => {
    if (TEST_DATABASE_URL === undefined)
      throw new Error('TEST_DATABASE_URL is not set')
    const domainTx = getDomainTx()
    await seedFoodMaster(domainTx, {
      id: 'fm_rice_happy',
      name: '白米 happy-path',
      source: 'user_input',
      nutrients: { energy_kcal: 168 },
    })

    const model = fakeModel()
      .respondWithTools([
        { name: 'search_food_master', args: { query: '白米' }, id: 'call_1' },
      ])
      .respondWithTools([
        {
          name: 'record_meal_log',
          args: {
            food_master_id: 'fm_rice_happy',
            eaten_at_iso: '2026-06-12T12:30:00+09:00',
            quantity: 200,
            unit: 'g',
          },
          id: 'call_2',
        },
      ])
      .respondWithTools([
        {
          name: 'meshi_agent_response',
          args: { status: 'completed', message: '白米 200g を記録しました。' },
          id: 'call_3',
        },
      ])

    const registry = buildRegistry(domainTx)
    const contextId = `ctx-${randomUUID()}`
    const checkpointer = createMeshiCheckpointer(TEST_DATABASE_URL)
    try {
      const client = await buildHarness({
        registry,
        model,
        checkpointer,
        taskStoreTx: getTaskStoreTx(),
      })
      const messageId = randomUUID()

      const task = await sendUserMessage(client, '昼に白米 200g を食べました', {
        messageId,
        contextId,
      })

      const userMessage: Message = {
        kind: 'message',
        messageId,
        role: 'user',
        parts: [{ kind: 'text', text: '昼に白米 200g を食べました' }],
        taskId: task.id,
        contextId,
      }
      const agentMessage = buildAgentMessage(
        task.id,
        contextId,
        '白米 200g を記録しました。',
      )
      expect(normalizeTask(task)).toEqual({
        kind: 'task',
        id: task.id,
        contextId,
        status: {
          state: 'completed',
          timestamp: NORMALIZED,
          message: agentMessage,
        },
        history: [userMessage, agentMessage],
      })

      const rows = await domainTx<
        { id: string; food_master_id: string; quantity: string; unit: string }[]
      >`SELECT id, food_master_id, quantity, unit FROM meal_logs`
      expect(rows).toEqual([
        {
          id: 'ml_a2a_test_0001',
          food_master_id: 'fm_rice_happy',
          quantity: '200',
          unit: 'g',
        },
      ])
    } finally {
      await checkpointer.deleteThread(contextId)
      await checkpointer.end()
    }
  })

  it('keeps an earlier item recorded while a later item stays unresolved in the same A2A turn', async () => {
    if (TEST_DATABASE_URL === undefined)
      throw new Error('TEST_DATABASE_URL is not set')
    const domainTx = getDomainTx()
    await seedFoodMaster(domainTx, {
      id: 'fm_rice_mixed',
      name: '白米 mixed-item',
      source: 'user_input',
      nutrients: { energy_kcal: 168 },
    })
    // A real fuzzy-match candidate for "salmon" — the scripted model's final
    // message is fixed regardless of the tool's actual output, but seeding
    // this exercises the real matcher end-to-end rather than a no-op search.
    await seedFoodMaster(domainTx, {
      id: 'fm_salmon_mixed',
      name: 'salmon sushi',
      source: 'user_input',
      nutrients: { energy_kcal: 150 },
    })

    const model = fakeModel()
      .respondWithTools([
        {
          name: 'record_meal_log',
          args: {
            food_master_id: 'fm_rice_mixed',
            eaten_at_iso: '2026-06-12T12:30:00+09:00',
            quantity: 200,
            unit: 'g',
          },
          id: 'call_1',
        },
      ])
      .respondWithTools([
        { name: 'search_food_master', args: { query: 'salmon' }, id: 'call_2' },
      ])
      .respondWithTools([
        {
          name: 'meshi_agent_response',
          args: {
            status: 'input_required',
            message: '白米は記録しました。salmon はどのメニューですか?',
          },
          id: 'call_3',
        },
      ])

    const registry = buildRegistry(domainTx)
    const contextId = `ctx-${randomUUID()}`
    const checkpointer = createMeshiCheckpointer(TEST_DATABASE_URL)
    try {
      const client = await buildHarness({
        registry,
        model,
        checkpointer,
        taskStoreTx: getTaskStoreTx(),
      })
      const messageId = randomUUID()

      const task = await sendUserMessage(
        client,
        '白米 200g と salmon を食べた',
        {
          messageId,
          contextId,
        },
      )

      const userMessage: Message = {
        kind: 'message',
        messageId,
        role: 'user',
        parts: [{ kind: 'text', text: '白米 200g と salmon を食べた' }],
        taskId: task.id,
        contextId,
      }
      const agentMessage = buildAgentMessage(
        task.id,
        contextId,
        '白米は記録しました。salmon はどのメニューですか?',
      )
      expect(normalizeTask(task)).toEqual({
        kind: 'task',
        id: task.id,
        contextId,
        status: {
          state: 'input-required',
          timestamp: NORMALIZED,
          message: agentMessage,
        },
        history: [userMessage, agentMessage],
      })

      // The ambiguous salmon item must not be force-recorded — only the
      // already-resolved rice item should have written a meal_logs row.
      const rows = await domainTx<
        { id: string; food_master_id: string; quantity: string; unit: string }[]
      >`SELECT id, food_master_id, quantity, unit FROM meal_logs`
      expect(rows).toEqual([
        {
          id: 'ml_a2a_test_0001',
          food_master_id: 'fm_rice_mixed',
          quantity: '200',
          unit: 'g',
        },
      ])
    } finally {
      await checkpointer.deleteThread(contextId)
      await checkpointer.end()
    }
  })

  it('resumes an input-required task with a follow-up message and completes after the checkpointer restores conversation state', async () => {
    if (TEST_DATABASE_URL === undefined)
      throw new Error('TEST_DATABASE_URL is not set')
    const domainTx = getDomainTx()
    await seedFoodMaster(domainTx, {
      id: 'fm_salmon_resume',
      name: 'salmon sushi resume',
      source: 'user_input',
      nutrients: { energy_kcal: 150 },
    })

    const model = fakeModel()
      .respondWithTools([
        { name: 'search_food_master', args: { query: 'salmon' }, id: 'call_1' },
      ])
      .respondWithTools([
        {
          name: 'meshi_agent_response',
          args: { status: 'input_required', message: 'どのメニューですか?' },
          id: 'call_2',
        },
      ])
      .respondWithTools([
        {
          name: 'record_meal_log',
          args: {
            food_master_id: 'fm_salmon_resume',
            eaten_at_iso: '2026-06-12T19:00:00+09:00',
            quantity: 180,
            unit: 'g',
          },
          id: 'call_3',
        },
      ])
      .respondWithTools([
        {
          name: 'meshi_agent_response',
          args: { status: 'completed', message: '記録しました。' },
          id: 'call_4',
        },
      ])

    const contextId = `ctx-${randomUUID()}`
    const taskStoreTx = getTaskStoreTx()

    // Two independent registry/checkpointer/agent/executor/app/client stacks
    // — each with its own registry instance, sharing only the underlying
    // Postgres state (domainTx's rows, taskStoreTx's task row, the
    // checkpointer's own tables) — simulating the server process handling
    // the second message after a restart, so this actually exercises
    // checkpointer persistence rather than in-process continuation.
    const checkpointer1 = createMeshiCheckpointer(TEST_DATABASE_URL)
    try {
      const client1 = await buildHarness({
        registry: buildRegistry(domainTx),
        model,
        checkpointer: checkpointer1,
        taskStoreTx,
      })
      const firstMessageId = randomUUID()

      const firstTask = await sendUserMessage(client1, 'salmon を食べた', {
        messageId: firstMessageId,
        contextId,
      })

      const firstUserMessage: Message = {
        kind: 'message',
        messageId: firstMessageId,
        role: 'user',
        parts: [{ kind: 'text', text: 'salmon を食べた' }],
        taskId: firstTask.id,
        contextId,
      }
      const firstAgentMessage = buildAgentMessage(
        firstTask.id,
        contextId,
        'どのメニューですか?',
      )
      expect(normalizeTask(firstTask)).toEqual({
        kind: 'task',
        id: firstTask.id,
        contextId,
        status: {
          state: 'input-required',
          timestamp: NORMALIZED,
          message: firstAgentMessage,
        },
        history: [firstUserMessage, firstAgentMessage],
      })

      const checkpointer2 = createMeshiCheckpointer(TEST_DATABASE_URL)
      try {
        const client2 = await buildHarness({
          registry: buildRegistry(domainTx),
          model,
          checkpointer: checkpointer2,
          taskStoreTx,
        })
        const secondMessageId = randomUUID()

        const secondTask = await sendUserMessage(
          client2,
          'salmon sushi の方です',
          {
            messageId: secondMessageId,
            taskId: firstTask.id,
            contextId,
          },
        )

        const secondUserMessage: Message = {
          kind: 'message',
          messageId: secondMessageId,
          role: 'user',
          parts: [{ kind: 'text', text: 'salmon sushi の方です' }],
          taskId: firstTask.id,
          contextId,
        }
        const secondAgentMessage = buildAgentMessage(
          firstTask.id,
          contextId,
          '記録しました。',
        )
        expect(normalizeTask(secondTask)).toEqual({
          kind: 'task',
          id: firstTask.id,
          contextId,
          status: {
            state: 'completed',
            timestamp: NORMALIZED,
            message: secondAgentMessage,
          },
          history: [
            firstUserMessage,
            firstAgentMessage,
            secondUserMessage,
            secondAgentMessage,
          ],
        })

        const rows = await domainTx<
          {
            id: string
            food_master_id: string
            quantity: string
            unit: string
          }[]
        >`SELECT id, food_master_id, quantity, unit FROM meal_logs`
        expect(rows).toEqual([
          {
            id: 'ml_a2a_test_0001',
            food_master_id: 'fm_salmon_resume',
            quantity: '180',
            unit: 'g',
          },
        ])
      } finally {
        await checkpointer2.end()
      }
    } finally {
      await checkpointer1.end()
      const cleanup = createMeshiCheckpointer(TEST_DATABASE_URL)
      try {
        await cleanup.deleteThread(contextId)
      } finally {
        await cleanup.end()
      }
    }
  })
})
