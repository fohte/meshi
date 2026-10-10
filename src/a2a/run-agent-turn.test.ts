import { randomUUID } from 'node:crypto'

import type { Message, Task } from '@a2a-js/sdk'
import type { AgentExecutionEvent } from '@a2a-js/sdk/server'
import { RequestContext } from '@a2a-js/sdk/server'
import { captureWithFingerprint } from '@fohte/service-kit/observability'
import { HumanMessage } from '@langchain/core/messages'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type MeshiDomainAgentLike, runAgentTurn } from '#a2a/run-agent-turn'
import type { AgentInvokeMessage } from '#llm/agent/derive-reply'
import { MESHI_AGENT_RECURSION_LIMIT } from '#llm/agent/domain-agent'
import { FALLBACK_QUESTION_TEXT } from '#llm/agent/fallback-question'
import { REQUEST_USER_INPUT_TOOL_NAME } from '#llm/agent/request-user-input-tool'
import type { Logger } from '#logger'

vi.mock('@fohte/service-kit/observability', () => ({
  captureWithFingerprint: vi.fn(),
}))

const NORMALIZED = 'NORMALIZED'
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

// Skips past runAgentTurn's onToolStart/logger positional parameters (unused
// by the tests calling this) to reach the `now` override, so callers don't
// have to spell out `undefined, undefined,` to get there.
const runAgentTurnAt = (
  agent: MeshiDomainAgentLike,
  requestContext: RequestContext,
  now: () => Date,
): Promise<Task> =>
  runAgentTurn(agent, requestContext, undefined, undefined, now)

describe('runAgentTurn', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('maps a plain-text reply with no tool call to a completed task', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi
        .fn()
        .mockResolvedValue(buildCompletedInvokeResult('Recorded your meal.')),
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

  it('maps a reply that calls request_user_input to an input-required task', async () => {
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

  it('maps a request_user_input call with empty reply text to an input-required task using the tool call question', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const existingTask = buildExistingTask(taskId, contextId)
    const userMessage = buildUserMessage(taskId, contextId, 'more info')
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        messages: [
          buildInvokeMessage('human'),
          buildInvokeMessage('ai', {
            text: '',
            toolCalls: [
              {
                name: REQUEST_USER_INPUT_TOOL_NAME,
                args: { question: 'Which food did you mean?' },
              },
            ],
          }),
        ],
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

  it('maps a request_user_input call with no usable text or question argument to an input-required task using the fallback question', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        messages: [
          buildInvokeMessage('human'),
          buildInvokeMessage('ai', {
            text: '',
            toolCalls: [{ name: REQUEST_USER_INPUT_TOOL_NAME }],
          }),
        ],
      }),
    }

    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      FALLBACK_QUESTION_TEXT,
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
      history: [userMessage, agentMessage],
    })
  })

  it('logs an event when request_user_input is called with no usable reply text', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        messages: [
          buildInvokeMessage('human'),
          buildInvokeMessage('ai', {
            text: '',
            toolCalls: [{ name: REQUEST_USER_INPUT_TOOL_NAME }],
          }),
        ],
      }),
    }
    const logs: Array<{
      event: string
      payload: Readonly<Record<string, unknown>> | undefined
    }> = []
    const logger: Logger = {
      log: (event, payload) => logs.push({ event, payload }),
    }

    await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
      undefined,
      logger,
    )

    expect(logs).toEqual([
      {
        event: 'meshi.agent_question_text_missing',
        payload: { taskId, contextId },
      },
    ])
  })

  it('falls back to a failed task when the agent produces no usable AI message text', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi
        .fn()
        .mockResolvedValue({ messages: [buildInvokeMessage('human')] }),
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

  it('logs a warn event when the agent produces no usable reply', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi
        .fn()
        .mockResolvedValue({ messages: [buildInvokeMessage('human')] }),
    }
    const logs: Array<{
      event: string
      payload: Readonly<Record<string, unknown>> | undefined
    }> = []
    const logger: Logger = {
      log: (event, payload) => logs.push({ event, payload }),
    }

    await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
      undefined,
      logger,
    )

    expect(logs).toEqual([
      { event: 'meshi.agent_no_usable_reply', payload: { taskId, contextId } },
    ])
  })

  it('reports to Sentry when the agent produces no usable reply', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi
        .fn()
        .mockResolvedValue({ messages: [buildInvokeMessage('human')] }),
    }

    await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    expect(captureWithFingerprint).toHaveBeenCalledExactlyOnceWith(
      expect.any(Error),
      'a2a.agent-executor.no-usable-reply',
      { extras: { taskId, contextId } },
    )
  })

  it('strips a leaked think block from the task message', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi
        .fn()
        .mockResolvedValue(
          buildCompletedInvokeResult('<think>reasoning</think>final answer'),
        ),
    }

    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      'final answer',
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

  it('logs a warn event when a think block leaks into the reply', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi
        .fn()
        .mockResolvedValue(
          buildCompletedInvokeResult('<think>reasoning</think>final answer'),
        ),
    }
    const logs: Array<{
      event: string
      payload: Readonly<Record<string, unknown>> | undefined
    }> = []
    const logger: Logger = {
      log: (event, payload) => logs.push({ event, payload }),
    }

    await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
      undefined,
      logger,
    )

    expect(logs).toEqual([
      {
        event: 'meshi.agent_think_block_leaked',
        payload: { taskId, contextId },
      },
    ])
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

  it('reports an agent invocation failure to Sentry', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const error = new Error('boom')
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockRejectedValue(error),
    }

    vi.spyOn(console, 'error').mockImplementation(() => {})
    await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    expect(captureWithFingerprint).toHaveBeenCalledExactlyOnceWith(
      error,
      'a2a.agent-executor.turn-failed',
      { extras: { taskId, contextId } },
    )
  })

  it('passes the converted user message content (including the occurred_at meta block), thread_id, and recursion limit to the domain agent', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const invoke = vi.fn().mockResolvedValue(buildCompletedInvokeResult('ok'))
    const agent: MeshiDomainAgentLike = { invoke }

    await runAgentTurnAt(
      agent,
      new RequestContext(userMessage, taskId, contextId),
      () => new Date('2026-07-30T03:00:00.000Z'),
    )

    expect(invoke).toHaveBeenCalledWith(
      {
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
      },
      {
        configurable: { thread_id: contextId },
        recursionLimit: MESHI_AGENT_RECURSION_LIMIT,
      },
    )
  })

  it('prepends an occurred_at/timezone meta block before the image content, using the injected now', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage: Message = {
      kind: 'message',
      messageId: `msg-${taskId}`,
      role: 'user',
      parts: [
        { kind: 'text', text: 'what is this?' },
        { kind: 'file', file: { bytes: 'imgdata', mimeType: 'image/webp' } },
      ],
      taskId,
      contextId,
    }
    const invoke = vi.fn().mockResolvedValue(buildCompletedInvokeResult('ok'))
    const agent: MeshiDomainAgentLike = { invoke }

    await runAgentTurnAt(
      agent,
      new RequestContext(userMessage, taskId, contextId),
      () => new Date('2026-07-30T03:00:00.000Z'),
    )

    expect(invoke).toHaveBeenCalledWith(
      {
        messages: [
          new HumanMessage({
            contentBlocks: [
              {
                type: 'text',
                text: '(meta: occurred_at=2026-07-30T03:00:00.000Z, timezone=Asia/Tokyo)',
              },
              { type: 'text', text: 'what is this?' },
              { type: 'image', mimeType: 'image/webp', data: 'imgdata' },
            ],
          }),
        ],
      },
      {
        configurable: { thread_id: contextId },
        recursionLimit: MESHI_AGENT_RECURSION_LIMIT,
      },
    )
  })

  it('defaults now to the real wall clock when omitted', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-30T03:00:00.000Z'))
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const invoke = vi.fn().mockResolvedValue(buildCompletedInvokeResult('ok'))
    const agent: MeshiDomainAgentLike = { invoke }

    await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    expect(invoke).toHaveBeenCalledWith(
      {
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
      },
      {
        configurable: { thread_id: contextId },
        recursionLimit: MESHI_AGENT_RECURSION_LIMIT,
      },
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
      invoke: vi.fn().mockResolvedValue(buildCompletedInvokeResult('ok')),
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

type InvokeConfig = Parameters<MeshiDomainAgentLike['invoke']>[1]

// Test-only stand-in for the arguments LangChain's BaseTool.invoke passes to
// handleToolStart (see buildProgressCallbacks in agent-executor.ts) — this
// file only cares about the tool-name (7th) argument, so the rest are inert
// placeholders.
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

describe('runAgentTurn progress callbacks', () => {
  it('invokes onToolStart with the name of each tool the domain agent starts', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const invoke = vi
      .fn()
      .mockImplementation((_input: unknown, config: InvokeConfig) => {
        fireHandleToolStart(config.callbacks, 'search_food_master')
        return buildCompletedInvokeResult('ok')
      })
    const agent: MeshiDomainAgentLike = { invoke }
    const onToolStart = vi.fn()

    await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
      onToolStart,
    )

    expect(onToolStart).toHaveBeenCalledExactlyOnceWith('search_food_master')
  })

  it('does not let an onToolStart failure abort the turn', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const invoke = vi
      .fn()
      .mockImplementation((_input: unknown, config: InvokeConfig) => {
        fireHandleToolStart(config.callbacks, 'search_food_master')
        return buildCompletedInvokeResult('ok')
      })
    const agent: MeshiDomainAgentLike = { invoke }
    const onToolStart = vi.fn().mockImplementation(() => {
      throw new Error('publish failed')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
      onToolStart,
    )

    const agentMessage = buildExpectedAgentMessage(taskId, contextId, 'ok')
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

  it('reports an onToolStart failure to Sentry', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const invoke = vi
      .fn()
      .mockImplementation((_input: unknown, config: InvokeConfig) => {
        fireHandleToolStart(config.callbacks, 'search_food_master')
        return buildCompletedInvokeResult('ok')
      })
    const agent: MeshiDomainAgentLike = { invoke }
    const progressError = new Error('publish failed')
    const onToolStart = vi.fn().mockImplementation(() => {
      throw progressError
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
      onToolStart,
    )

    expect(captureWithFingerprint).toHaveBeenCalledExactlyOnceWith(
      progressError,
      'a2a.agent-executor.progress-failed',
      { extras: { taskId, contextId } },
    )
  })
})

const QUERY_MEAL_HISTORY_OUTPUT = {
  totals: { energy_kcal: 300 },
  per_day: [
    {
      date: '2026-06-12',
      totals: { energy_kcal: 300 },
      has_unknown_values: false,
    },
  ],
  entries: [
    {
      meal_log_id: 'ml_1',
      food_master_id: 'fm_rice',
      food_name: '白米',
      eaten_date: '2026-06-12',
      meal_type: 'lunch',
      quantity: 200,
      nutrition_status: 'confirmed',
    },
  ],
  has_estimated_values: false,
  has_unknown_values: false,
}

describe('runAgentTurn meal history itemization', () => {
  it("appends a deterministic itemized entries block from this turn's query_meal_history result", async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId, '最近の食事は?')
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        messages: [
          buildInvokeMessage('human'),
          buildInvokeMessage('ai'),
          buildInvokeMessage('tool', {
            name: 'query_meal_history',
            content: JSON.stringify(QUERY_MEAL_HISTORY_OUTPUT),
          }),
          buildInvokeMessage('ai', {
            text: '直近の食事履歴をお伝えしました。',
          }),
        ],
      }),
    }

    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      [
        '直近の食事履歴をお伝えしました。',
        '',
        '明細 (1 件):',
        '- 2026-06-12 昼食 白米 × 200',
      ].join('\n'),
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

  it("does not leak an earlier turn's query_meal_history result into a later unrelated turn", async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId, '白米を記録して')
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        messages: [
          // An earlier turn's query_meal_history exchange, still present in
          // the checkpointer-accumulated thread history.
          buildInvokeMessage('human'),
          buildInvokeMessage('tool', {
            name: 'query_meal_history',
            content: JSON.stringify(QUERY_MEAL_HISTORY_OUTPUT),
          }),
          buildInvokeMessage('ai'),
          // This turn's own exchange never calls query_meal_history.
          buildInvokeMessage('human'),
          buildInvokeMessage('tool', {
            name: 'record_meal_log',
            content: '{}',
          }),
          buildInvokeMessage('ai', { text: '記録しました。' }),
        ],
      }),
    }

    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      '記録しました。',
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

  it('ignores a query_meal_history tool message whose content does not match the expected schema', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId, '最近の食事は?')
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        messages: [
          buildInvokeMessage('human'),
          buildInvokeMessage('tool', {
            name: 'query_meal_history',
            content: JSON.stringify({
              error: { code: 'internal_error', message: 'db unavailable' },
            }),
          }),
          buildInvokeMessage('ai', { text: '履歴の取得に失敗しました。' }),
        ],
      }),
    }

    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      '履歴の取得に失敗しました。',
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

  it('ignores a query_meal_history tool message whose content is not valid JSON', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId, '最近の食事は?')
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        messages: [
          buildInvokeMessage('human'),
          buildInvokeMessage('tool', {
            name: 'query_meal_history',
            content: 'not json{',
          }),
          buildInvokeMessage('ai', { text: '履歴の取得に失敗しました。' }),
        ],
      }),
    }

    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      '履歴の取得に失敗しました。',
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

  it('does not append an itemized block when the aggregate has no entries', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId, '最近の食事は?')
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        messages: [
          buildInvokeMessage('human'),
          buildInvokeMessage('tool', {
            name: 'query_meal_history',
            content: JSON.stringify({
              totals: {},
              per_day: [],
              entries: [],
              has_estimated_values: false,
            }),
          }),
          buildInvokeMessage('ai', {
            text: '該当する記録はありませんでした。',
          }),
        ],
      }),
    }

    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      '該当する記録はありませんでした。',
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
})

describe('runAgentTurn food master disclosure', () => {
  it("appends a deterministic disclosure block for this turn's registered foods", async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(
      taskId,
      contextId,
      '抹茶ラテを飲みました',
    )
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockResolvedValue({
        messages: [
          buildInvokeMessage('human'),
          buildInvokeMessage('ai'),
          buildInvokeMessage('tool', {
            name: 'register_food_master',
            content: JSON.stringify({
              food_master_id: 'fm_test_0001',
              name: 'カフェの抹茶ラテ',
              source: 'web_search',
              source_url: 'https://example.com/matcha',
              nutrition_per_100g: { energy_kcal: 60, protein_g: 2 },
            }),
          }),
          buildInvokeMessage('ai', { text: '記録しました。' }),
        ],
      }),
    }

    const task = await runAgentTurn(
      agent,
      new RequestContext(userMessage, taskId, contextId),
    )

    const agentMessage = buildExpectedAgentMessage(
      taskId,
      contextId,
      [
        '記録しました。',
        '',
        '新しく登録した食品:',
        '- カフェの抹茶ラテ 60kcal',
        '  出典: https://example.com/matcha (web検索)',
        '値が違う場合は教えてください。',
      ].join('\n'),
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
})
