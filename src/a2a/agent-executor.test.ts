import { randomUUID } from 'node:crypto'

import type { Message, Task } from '@a2a-js/sdk'
import type { AgentExecutionEvent, ExecutionEventBus } from '@a2a-js/sdk/server'
import { RequestContext } from '@a2a-js/sdk/server'
import { captureWithFingerprint } from '@fohte/service-kit/observability'
import { HumanMessage } from '@langchain/core/messages'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMeshiAgentExecutor } from '#a2a/agent-executor'
import type { MeshiDomainAgentLike } from '#a2a/run-agent-turn'
import type { Sql } from '#db/index'
import type { AgentInvokeMessage } from '#llm/agent/derive-reply'
import { REQUEST_USER_INPUT_TOOL_NAME } from '#llm/agent/request-user-input-tool'
import { describeIfDb, getTestSql } from '#test/db'

vi.mock('@fohte/service-kit/observability', () => ({
  captureWithFingerprint: vi.fn(),
}))

const NORMALIZED = 'NORMALIZED'

// Minimal fake of postgres.Sql's reserve() surface: withAdvisoryLock only
// ever calls .reserve() (and the tagged-template + release() it returns),
// so tests that don't care about real lock/unlock behavior can use this
// instead of a real Postgres connection — which matters for the heartbeat
// test below, since a real connection's socket I/O doesn't mix reliably
// with fake timers.
const buildFakeSql = (): Sql => {
  const reserved = Object.assign(() => Promise.resolve([]), {
    release: () => {},
  })
  const fakeSql = { reserve: () => Promise.resolve(reserved) }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- see comment above; only .reserve() is ever called on this value.
  return fakeSql as unknown as Sql
}

const buildUserMessage = (
  taskId: string,
  contextId: string,
  text = 'hello',
): Message => ({
  kind: 'message',
  messageId: `msg-${taskId}`,
  role: 'user',
  parts: [{ kind: 'text', text }],
  taskId,
  contextId,
})

const buildExistingTask = (
  taskId: string,
  contextId: string,
  overrides: Partial<Task> = {},
): Task => ({
  kind: 'task',
  id: taskId,
  contextId,
  status: { state: 'input-required', timestamp: new Date().toISOString() },
  history: buildExistingTaskHistory(taskId, contextId),
  ...overrides,
})

// A fresh array with the same content as an existing task's fixture
// history, for assertions that need it without a non-null assertion on
// Task['history'] (which is optional in the SDK type, even though this
// fixture always sets it).
const buildExistingTaskHistory = (
  taskId: string,
  contextId: string,
): Message[] => [
  buildUserMessage(taskId, contextId, 'first message'),
  {
    kind: 'message',
    role: 'agent',
    messageId: 'agent-question',
    parts: [{ kind: 'text', text: 'which food did you mean?' }],
    taskId,
    contextId,
  },
  buildUserMessage(taskId, contextId, 'the apple'),
]

// Builds the agent reply Task.status.message this executor would produce,
// with a normalized messageId (the real one is a random UUID) — reused as
// the expected value for both `status.message` and the trailing entry of
// `history`, since buildFinalTask always carries the same message object to
// both places.
const buildExpectedAgentMessage = (
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

// Timestamps and the agent's random messageId are the only non-deterministic
// fields; normalizing them lets each test assert the full published event
// with one equality check instead of picking fields apart. The trailing
// history entry is the same agent-authored message as status.message, so it
// gets the same normalization; earlier entries are fixture-controlled.
const normalizeEvent = (event: AgentExecutionEvent): AgentExecutionEvent => {
  if (event.kind === 'task') {
    const lastHistoryEntry = event.history?.at(-1)
    return {
      ...event,
      status: {
        ...event.status,
        timestamp: NORMALIZED,
        ...(event.status.message !== undefined
          ? { message: { ...event.status.message, messageId: NORMALIZED } }
          : {}),
      },
      ...(event.history !== undefined && lastHistoryEntry?.role === 'agent'
        ? {
            history: [
              ...event.history.slice(0, -1),
              { ...lastHistoryEntry, messageId: NORMALIZED },
            ],
          }
        : {}),
    }
  }
  if (event.kind === 'status-update') {
    return {
      ...event,
      status: {
        ...event.status,
        timestamp: NORMALIZED,
        ...(event.status.message !== undefined
          ? { message: { ...event.status.message, messageId: NORMALIZED } }
          : {}),
      },
    }
  }
  return event
}

const buildInvokeMessage = (
  type: string,
  overrides: {
    name?: string
    content?: unknown
    text?: string
    toolCalls?: ReadonlyArray<{ name: string; args?: unknown }>
  } = {},
): AgentInvokeMessage => ({
  getType: () => type,
  ...(overrides.name !== undefined ? { name: overrides.name } : {}),
  content: overrides.content ?? '',
  text: overrides.text ?? '',
  ...(overrides.toolCalls !== undefined
    ? { tool_calls: overrides.toolCalls }
    : {}),
})

const buildCompletedInvokeResult = (
  text: string,
): { messages: AgentInvokeMessage[] } => ({
  messages: [buildInvokeMessage('human'), buildInvokeMessage('ai', { text })],
})

type InvokeConfig = Parameters<MeshiDomainAgentLike['invoke']>[1]

const fireHandleToolStart = (
  callbacks: InvokeConfig['callbacks'],
  toolName: string,
): void => {
  callbacks?.[0]?.handleToolStart?.(
    { lc: 1, type: 'not_implemented', id: [] },
    '{}',
    'run-1',
    undefined,
    undefined,
    undefined,
    toolName,
  )
}

const buildEventBus = (): {
  bus: ExecutionEventBus
  published: AgentExecutionEvent[]
  finished: ReturnType<typeof vi.fn>
} => {
  const published: AgentExecutionEvent[] = []
  const finished = vi.fn()
  const bus: ExecutionEventBus = {
    publish(event) {
      published.push(event)
    },
    finished,
    on: () => bus,
    off: () => bus,
    once: () => bus,
    removeAllListeners: () => bus,
  }
  return { bus, published, finished }
}

describeIfDb('createMeshiAgentExecutor', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('seeds the store with an initial working task, then publishes the final task, for a new task', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi
        .fn()
        .mockResolvedValue(buildCompletedInvokeResult('Recorded your meal.')),
    }
    const executor = createMeshiAgentExecutor({
      agent,
      sql: getTestSql(),
      heartbeatIntervalMs: 1_000_000,
    })
    const { bus, published, finished } = buildEventBus()

    await executor.execute(
      new RequestContext(userMessage, taskId, contextId),
      bus,
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      'Recorded your meal.',
    )
    expect(published.map(normalizeEvent)).toEqual([
      {
        kind: 'task',
        id: taskId,
        contextId,
        status: { state: 'working', timestamp: NORMALIZED },
        history: [userMessage],
      },
      {
        kind: 'task',
        id: taskId,
        contextId,
        status: {
          state: 'completed',
          timestamp: NORMALIZED,
          message: agentMessage,
        },
        history: [userMessage, agentMessage],
      },
    ])
    expect(finished).toHaveBeenCalledOnce()
  })

  it('forwards the now option into the occurred_at meta passed to the domain agent', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const invoke = vi.fn().mockResolvedValue(buildCompletedInvokeResult('ok'))
    const agent: MeshiDomainAgentLike = { invoke }
    const executor = createMeshiAgentExecutor({
      agent,
      sql: getTestSql(),
      heartbeatIntervalMs: 1_000_000,
      now: () => new Date('2026-07-30T03:00:00.000Z'),
    })
    const { bus } = buildEventBus()

    await executor.execute(
      new RequestContext(userMessage, taskId, contextId),
      bus,
    )

    // Only the messages argument is this test's concern (does options.now
    // reach the occurred_at meta); thread_id/recursionLimit/callbacks are
    // already covered by the other executor and runAgentTurn tests.
    expect(invoke.mock.calls[0]?.[0]).toEqual({
      messages: [
        new HumanMessage({
          contentBlocks: [
            {
              type: 'text',
              text: '(meta: occurred_at=2026-07-30T03:00:00.000Z, timezone=Asia/Tokyo)',
            },
            { type: 'text', text: 'hello' },
          ],
        }),
      ],
    })
  })

  it('publishes a working status-update before resuming an existing task', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const existingTask = buildExistingTask(taskId, contextId)
    const userMessage = buildUserMessage(taskId, contextId, 'more info')
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        messages: [
          buildInvokeMessage('human'),
          buildInvokeMessage('ai', {
            text: 'Which food did you mean?',
            toolCalls: [{ name: REQUEST_USER_INPUT_TOOL_NAME }],
          }),
        ],
      }),
    }
    const executor = createMeshiAgentExecutor({
      agent,
      sql: getTestSql(),
      heartbeatIntervalMs: 1_000_000,
    })
    const { bus, published } = buildEventBus()

    await executor.execute(
      new RequestContext(userMessage, taskId, contextId, existingTask),
      bus,
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      'Which food did you mean?',
    )
    expect(published.map(normalizeEvent)).toEqual([
      {
        kind: 'status-update',
        taskId,
        contextId,
        status: { state: 'working', timestamp: NORMALIZED },
        final: false,
      },
      {
        kind: 'task',
        id: taskId,
        contextId,
        status: {
          state: 'input-required',
          timestamp: NORMALIZED,
          message: agentMessage,
        },
        history: [...buildExistingTaskHistory(taskId, contextId), agentMessage],
      },
    ])
  })

  it('serializes concurrent executions for the same contextId behind the advisory lock', async () => {
    const contextId = `ctx-${randomUUID()}`
    let concurrent = 0
    let maxConcurrent = 0
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockImplementation(async () => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise((resolve) => setTimeout(resolve, 50))
        concurrent -= 1
        return buildCompletedInvokeResult('ok')
      }),
    }
    const executor = createMeshiAgentExecutor({
      agent,
      sql: getTestSql(),
      heartbeatIntervalMs: 1_000_000,
    })

    const taskIdA = `task-${randomUUID()}`
    const taskIdB = `task-${randomUUID()}`
    await Promise.all([
      executor.execute(
        new RequestContext(
          buildUserMessage(taskIdA, contextId),
          taskIdA,
          contextId,
        ),
        buildEventBus().bus,
      ),
      executor.execute(
        new RequestContext(
          buildUserMessage(taskIdB, contextId),
          taskIdB,
          contextId,
        ),
        buildEventBus().bus,
      ),
    ])

    expect(maxConcurrent).toBe(1)
  })

  it.each([
    {
      toolName: 'search_food_master',
      toolResultText: 'Recorded your meal.',
      progressText: 'Looking up the food in the food database...',
    },
    {
      toolName: 'update_meal_log',
      toolResultText: 'Updated your meal.',
      progressText: 'Updating your meal record...',
    },
  ])(
    'publishes an immediate status-update with progress text when the agent starts $toolName',
    async ({ toolName, toolResultText, progressText }) => {
      const contextId = `ctx-${randomUUID()}`
      const taskId = `task-${randomUUID()}`
      const userMessage = buildUserMessage(taskId, contextId)
      const agent: MeshiDomainAgentLike = {
        invoke: vi
          .fn()
          .mockImplementation((_input: unknown, config: InvokeConfig) => {
            fireHandleToolStart(config.callbacks, toolName)
            return buildCompletedInvokeResult(toolResultText)
          }),
      }
      const executor = createMeshiAgentExecutor({
        agent,
        sql: getTestSql(),
        heartbeatIntervalMs: 1_000_000,
      })
      const { bus, published } = buildEventBus()

      await executor.execute(
        new RequestContext(userMessage, taskId, contextId),
        bus,
      )

      const progressMessage = buildExpectedAgentMessage(
        taskId,
        contextId,
        progressText,
      )
      const agentMessage = buildExpectedAgentMessage(
        taskId,
        contextId,
        toolResultText,
      )
      expect(published.map(normalizeEvent)).toEqual([
        {
          kind: 'task',
          id: taskId,
          contextId,
          status: { state: 'working', timestamp: NORMALIZED },
          history: [userMessage],
        },
        {
          kind: 'status-update',
          taskId,
          contextId,
          status: {
            state: 'working',
            timestamp: NORMALIZED,
            message: progressMessage,
          },
          final: false,
        },
        {
          kind: 'task',
          id: taskId,
          contextId,
          status: {
            state: 'completed',
            timestamp: NORMALIZED,
            message: agentMessage,
          },
          history: [userMessage, agentMessage],
        },
      ])
    },
  )

  it('does not publish a progress status-update for a tool name with no mapped progress text', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi
        .fn()
        .mockImplementation((_input: unknown, config: InvokeConfig) => {
          // meshi_agent_response is the synthetic structured-output tool
          // (see response-schema.ts) — it reports the turn's outcome, not
          // an in-progress step, so it's deliberately unmapped.
          fireHandleToolStart(config.callbacks, 'meshi_agent_response')
          return buildCompletedInvokeResult('ok')
        }),
    }
    const executor = createMeshiAgentExecutor({
      agent,
      sql: getTestSql(),
      heartbeatIntervalMs: 1_000_000,
    })
    const { bus, published } = buildEventBus()

    await executor.execute(
      new RequestContext(userMessage, taskId, contextId),
      bus,
    )

    expect(published.map((event) => event.kind)).toEqual(['task', 'task'])
  })
})

// The agent's invoke() Promise executor only runs once execute() actually
// calls invoke() (not when this factory runs), so resolveInvoke defers to
// whichever `resolve` that later call captures rather than being returned
// directly. onInvoke, when given, runs synchronously inside that same
// Promise executor — the same point in the call stack LangChain itself
// would fire handleToolStart from — letting a test simulate a tool call
// starting before invoke() resolves.
const buildPendingAgent = (
  onInvoke?: (config: InvokeConfig) => void,
): {
  agent: MeshiDomainAgentLike
  resolveInvoke: (value: { messages: AgentInvokeMessage[] }) => void
} => {
  let resolve: ((value: { messages: AgentInvokeMessage[] }) => void) | undefined
  const agent: MeshiDomainAgentLike = {
    invoke: vi.fn().mockImplementation(
      (_input: unknown, config: InvokeConfig) =>
        new Promise((res) => {
          onInvoke?.(config)
          resolve = res
        }),
    ),
  }
  return { agent, resolveInvoke: (value) => resolve?.(value) }
}

// The initial task-seed event is publish call #1; the first heartbeat tick
// is #2 — make only that one throw, simulating a transient event bus
// failure on a single heartbeat.
const buildFailingHeartbeatBus = (
  error: Error,
): { bus: ExecutionEventBus; published: AgentExecutionEvent[] } => {
  const published: AgentExecutionEvent[] = []
  let publishCount = 0
  const bus: ExecutionEventBus = {
    publish(event) {
      publishCount += 1
      if (publishCount === 2) throw error
      published.push(event)
    },
    finished: vi.fn(),
    on: () => bus,
    off: () => bus,
    once: () => bus,
    removeAllListeners: () => bus,
  }
  return { bus, published }
}

describe('createMeshiAgentExecutor heartbeat', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('publishes periodic working heartbeats while the agent is running', async () => {
    vi.useFakeTimers()
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const { agent, resolveInvoke } = buildPendingAgent()
    const executor = createMeshiAgentExecutor({
      agent,
      sql: buildFakeSql(),
      heartbeatIntervalMs: 1_000,
    })
    const { bus, published } = buildEventBus()

    const executing = executor.execute(
      new RequestContext(userMessage, taskId, contextId),
      bus,
    )

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    resolveInvoke(buildCompletedInvokeResult('ok'))
    await executing

    const heartbeats = published.filter(
      (event) => event.kind === 'status-update',
    )
    expect(heartbeats).toHaveLength(3)
  })

  it('carries the latest tool-start progress text forward into later heartbeats', async () => {
    vi.useFakeTimers()
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const { agent, resolveInvoke } = buildPendingAgent((config) => {
      fireHandleToolStart(config.callbacks, 'search_food_master')
    })
    const executor = createMeshiAgentExecutor({
      agent,
      sql: buildFakeSql(),
      heartbeatIntervalMs: 1_000,
    })
    const { bus, published } = buildEventBus()

    const executing = executor.execute(
      new RequestContext(userMessage, taskId, contextId),
      bus,
    )

    await vi.advanceTimersByTimeAsync(1_000)
    resolveInvoke(buildCompletedInvokeResult('ok'))
    await executing

    const progressMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      'Looking up the food in the food database...',
    )
    // The first status-update is the immediate publish fired when
    // search_food_master started; the second is the 1s heartbeat tick,
    // carrying that same progress text forward instead of dropping it.
    const statusUpdates = published.filter(
      (event) => event.kind === 'status-update',
    )
    expect(statusUpdates.map(normalizeEvent)).toEqual([
      {
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: 'working',
          timestamp: NORMALIZED,
          message: progressMessage,
        },
        final: false,
      },
      {
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state: 'working',
          timestamp: NORMALIZED,
          message: progressMessage,
        },
        final: false,
      },
    ])
  })

  it('does not let a heartbeat publish failure abort the execution', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const { agent, resolveInvoke } = buildPendingAgent()
    const executor = createMeshiAgentExecutor({
      agent,
      sql: buildFakeSql(),
      heartbeatIntervalMs: 1_000,
    })
    const { bus, published } = buildFailingHeartbeatBus(
      new Error('event bus unavailable'),
    )

    const executing = executor.execute(
      new RequestContext(userMessage, taskId, contextId),
      bus,
    )

    await vi.advanceTimersByTimeAsync(1_000)
    resolveInvoke(buildCompletedInvokeResult('ok'))
    await expect(executing).resolves.toBeUndefined()

    expect(published.map((event) => event.kind)).toEqual(['task', 'task'])
  })

  it('reports a heartbeat publish failure to Sentry', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const { agent, resolveInvoke } = buildPendingAgent()
    const executor = createMeshiAgentExecutor({
      agent,
      sql: buildFakeSql(),
      heartbeatIntervalMs: 1_000,
    })
    const error = new Error('event bus unavailable')
    const { bus } = buildFailingHeartbeatBus(error)

    const executing = executor.execute(
      new RequestContext(userMessage, taskId, contextId),
      bus,
    )

    await vi.advanceTimersByTimeAsync(1_000)
    resolveInvoke(buildCompletedInvokeResult('ok'))
    await executing

    expect(captureWithFingerprint).toHaveBeenCalledExactlyOnceWith(
      error,
      'a2a.agent-executor.heartbeat-failed',
      { extras: { taskId, contextId } },
    )
  })
})
