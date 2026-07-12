import { randomUUID } from 'node:crypto'

import type { Message, Task } from '@a2a-js/sdk'
import type { AgentExecutionEvent, ExecutionEventBus } from '@a2a-js/sdk/server'
import { RequestContext } from '@a2a-js/sdk/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MeshiDomainAgentLike } from '@/a2a/agent-executor'
import { createMeshiAgentExecutor, runAgentTurn } from '@/a2a/agent-executor'
import type { Sql } from '@/db'
import { describeIfDb, getTestSql } from '@/test/db'

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
// fields; normalizing them in lets each test assert the full published event
// (or, for runAgentTurn, the returned Task directly — it's one of the same
// AgentExecutionEvent shapes) with one equality check instead of picking
// fields apart. The trailing history entry is the same agent-authored
// message as status.message (see buildFinalTask), so it gets the same
// normalization; earlier entries (from an existing task's history) are
// left untouched since their messageIds are fixture-controlled.
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
    return { ...event, status: { ...event.status, timestamp: NORMALIZED } }
  }
  return event
}

describe('runAgentTurn', () => {
  it('maps a completed structured response to a completed task', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        structuredResponse: {
          status: 'completed',
          message: 'Recorded your meal.',
        },
      }),
    }

    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      'Recorded your meal.',
    )
    expect(normalizeEvent(task)).toEqual({
      kind: 'task',
      id: taskId,
      contextId,
      status: {
        state: 'completed',
        timestamp: NORMALIZED,
        message: agentMessage,
      },
      history: [userMessage, agentMessage],
    })
  })

  it('maps an input_required structured response to an input-required task', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const existingTask = buildExistingTask(taskId, contextId)
    const userMessage = buildUserMessage(taskId, contextId, 'more info')
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        structuredResponse: {
          status: 'input_required',
          message: 'Which food did you mean?',
        },
      }),
    }

    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId, existingTask),
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      'Which food did you mean?',
    )
    expect(normalizeEvent(task)).toEqual({
      kind: 'task',
      id: taskId,
      contextId,
      status: {
        state: 'input-required',
        timestamp: NORMALIZED,
        message: agentMessage,
      },
      history: [...buildExistingTaskHistory(taskId, contextId), agentMessage],
    })
  })

  it('maps an error structured response to a failed task without an error_kind', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        structuredResponse: {
          status: 'error',
          message: 'That food could not be found.',
        },
      }),
    }

    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      'That food could not be found.',
    )
    expect(normalizeEvent(task)).toEqual({
      kind: 'task',
      id: taskId,
      contextId,
      status: { state: 'failed', timestamp: NORMALIZED, message: agentMessage },
      history: [userMessage, agentMessage],
    })
  })

  it('falls back to a failed task when the structured response does not match the expected schema', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi
        .fn()
        .mockResolvedValue({ structuredResponse: { unexpected: true } }),
    }

    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      'The agent did not return a valid response.',
    )
    expect(normalizeEvent(task)).toEqual({
      kind: 'task',
      id: taskId,
      contextId,
      status: { state: 'failed', timestamp: NORMALIZED, message: agentMessage },
      history: [userMessage, agentMessage],
    })
  })

  it('tags a usage-limit failure with error_kind on the failed task', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const usageLimitError = Object.assign(new Error('rate limited'), {
      rateLimitType: 'stop',
    })
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockRejectedValue(usageLimitError),
    }

    vi.spyOn(console, 'error').mockImplementation(() => {})
    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      'rate limited',
    )
    expect(normalizeEvent(task)).toEqual({
      kind: 'task',
      id: taskId,
      contextId,
      status: { state: 'failed', timestamp: NORMALIZED, message: agentMessage },
      history: [userMessage, agentMessage],
      metadata: { error_kind: 'usage_limit' },
    })
  })

  // A short Retry-After (<=60s) classifies as 'wait' and is retried
  // in-place by AsyncCaller — but if every retry keeps hitting the same
  // limit, p-retry eventually exhausts its own budget and throws that same
  // 'wait'-tagged error anyway, so this must count as usage_limit too.
  it('tags a retry-exhausted "wait" classification with error_kind on the failed task', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const waitClassifiedError = Object.assign(new Error('rate limited'), {
      rateLimitType: 'wait',
    })
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockRejectedValue(waitClassifiedError),
    }

    vi.spyOn(console, 'error').mockImplementation(() => {})
    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    expect(task.metadata).toEqual({ error_kind: 'usage_limit' })
  })

  it('does not tag a plain failure with error_kind', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockRejectedValue(new Error('boom')),
    }

    vi.spyOn(console, 'error').mockImplementation(() => {})
    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    const agentMessage = buildExpectedAgentMessage(taskId, contextId, 'boom')
    expect(normalizeEvent(task)).toEqual({
      kind: 'task',
      id: taskId,
      contextId,
      status: { state: 'failed', timestamp: NORMALIZED, message: agentMessage },
      history: [userMessage, agentMessage],
    })
  })

  it('passes the converted user message content and thread_id to the domain agent', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const invoke = vi.fn().mockResolvedValue({
      structuredResponse: { status: 'completed', message: 'ok' },
    })
    const agent: MeshiDomainAgentLike = { invoke }

    await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    expect(invoke).toHaveBeenCalledWith(
      {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        ],
      },
      { configurable: { thread_id: contextId } },
    )
  })

  it('carries forward the existing task history and artifacts on the final task', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const existingTask = buildExistingTask(taskId, contextId, {
      artifacts: [
        { artifactId: 'artifact-1', parts: [{ kind: 'text', text: 'x' }] },
      ],
    })
    const userMessage = buildUserMessage(taskId, contextId, 'more info')
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        structuredResponse: { status: 'completed', message: 'ok' },
      }),
    }

    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId, existingTask),
    )

    // task.status.message is the exact same agent-authored message object
    // buildFinalTask appends to history, so reusing it here (rather than
    // hand-constructing its random messageId) keeps this a precise
    // equality check without depending on the message content itself,
    // which is what "carries forward" is testing.
    expect(task.history).toEqual([
      ...buildExistingTaskHistory(taskId, contextId),
      task.status.message,
    ])
    expect(task.artifacts).toEqual(existingTask.artifacts)
  })
})

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
      invoke: vi.fn().mockResolvedValue({
        structuredResponse: {
          status: 'completed',
          message: 'Recorded your meal.',
        },
      }),
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

  it('publishes a working status-update before resuming an existing task', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const existingTask = buildExistingTask(taskId, contextId)
    const userMessage = buildUserMessage(taskId, contextId, 'more info')
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        structuredResponse: {
          status: 'input_required',
          message: 'Which food did you mean?',
        },
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
        return { structuredResponse: { status: 'completed', message: 'ok' } }
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
})

describe('createMeshiAgentExecutor heartbeat', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('publishes periodic working heartbeats while the agent is running', async () => {
    vi.useFakeTimers()
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    let resolveInvoke:
      ((value: { structuredResponse: unknown }) => void) | undefined
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveInvoke = resolve
          }),
      ),
    }
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
    resolveInvoke?.({
      structuredResponse: { status: 'completed', message: 'ok' },
    })
    await executing

    const heartbeats = published.filter(
      (event) => event.kind === 'status-update',
    )
    expect(heartbeats).toHaveLength(3)
  })

  it('does not let a heartbeat publish failure abort the execution', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    let resolveInvoke:
      ((value: { structuredResponse: unknown }) => void) | undefined
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveInvoke = resolve
          }),
      ),
    }
    const executor = createMeshiAgentExecutor({
      agent,
      sql: buildFakeSql(),
      heartbeatIntervalMs: 1_000,
    })
    // The initial task-seed event is publish call #1; the first heartbeat
    // tick is #2 — make only that one throw, simulating a transient event
    // bus failure on a single heartbeat.
    let publishCount = 0
    const published: AgentExecutionEvent[] = []
    const bus: ExecutionEventBus = {
      publish(event) {
        publishCount += 1
        if (publishCount === 2) {
          throw new Error('event bus unavailable')
        }
        published.push(event)
      },
      finished: vi.fn(),
      on: () => bus,
      off: () => bus,
      once: () => bus,
      removeAllListeners: () => bus,
    }

    const executing = executor.execute(
      new RequestContext(userMessage, taskId, contextId),
      bus,
    )

    await vi.advanceTimersByTimeAsync(1_000)
    resolveInvoke?.({
      structuredResponse: { status: 'completed', message: 'ok' },
    })
    await expect(executing).resolves.toBeUndefined()

    expect(published.map((event) => event.kind)).toEqual(['task', 'task'])
  })
})
