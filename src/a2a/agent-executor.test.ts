import { randomUUID } from 'node:crypto'

import type { Message, Task } from '@a2a-js/sdk'
import type { AgentExecutionEvent, ExecutionEventBus } from '@a2a-js/sdk/server'
import { RequestContext } from '@a2a-js/sdk/server'
import { expect, it, vi } from 'vitest'

import type { MeshiDomainAgentLike } from '@/a2a/agent-executor'
import { createMeshiAgentExecutor } from '@/a2a/agent-executor'
import { describeIfDb, getTestSql } from '@/test/db'

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

const buildExistingTask = (taskId: string, contextId: string): Task => ({
  kind: 'task',
  id: taskId,
  contextId,
  status: { state: 'input-required', timestamp: new Date().toISOString() },
  history: [
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
  ],
})

// Timestamps and the agent's random messageId are the only non-deterministic
// fields; normalizing them in lets each test assert the full published event
// with one equality check instead of picking fields apart.
const normalizeEvent = (event: AgentExecutionEvent): AgentExecutionEvent => {
  if (event.kind === 'task') {
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
  if (event.kind === 'status-update') {
    return { ...event, status: { ...event.status, timestamp: NORMALIZED } }
  }
  return event
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

const lastEvent = (
  published: readonly AgentExecutionEvent[],
): AgentExecutionEvent => {
  const event = published.at(-1)
  if (event === undefined) {
    throw new Error('expected at least one published event')
  }
  return event
}

describeIfDb('createMeshiAgentExecutor', () => {
  it('maps a completed structured response to a completed task, seeding the store with an initial working task for a new task', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const invoke = vi.fn().mockResolvedValue({
      structuredResponse: {
        status: 'completed',
        message: 'Recorded your meal.',
      },
    })
    const agent: MeshiDomainAgentLike = { invoke }
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
          message: {
            kind: 'message',
            role: 'agent',
            messageId: NORMALIZED,
            parts: [{ kind: 'text', text: 'Recorded your meal.' }],
            taskId,
            contextId,
          },
        },
        history: [userMessage],
      },
    ])
    expect(finished).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith(
      {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        ],
      },
      { configurable: { thread_id: contextId } },
    )
  })

  it('maps an input_required structured response to input-required, publishing a working status-update for a resumed task', async () => {
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
          message: {
            kind: 'message',
            role: 'agent',
            messageId: NORMALIZED,
            parts: [{ kind: 'text', text: 'Which food did you mean?' }],
            taskId,
            contextId,
          },
        },
        history: existingTask.history,
      },
    ])
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

    const finalEvent = normalizeEvent(lastEvent(published))
    expect(finalEvent).toEqual({
      kind: 'task',
      id: taskId,
      contextId,
      status: {
        state: 'failed',
        timestamp: NORMALIZED,
        message: {
          kind: 'message',
          role: 'agent',
          messageId: NORMALIZED,
          parts: [{ kind: 'text', text: 'That food could not be found.' }],
          taskId,
          contextId,
        },
      },
      history: [userMessage],
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

    const finalEvent = normalizeEvent(lastEvent(published))
    expect(finalEvent).toEqual({
      kind: 'task',
      id: taskId,
      contextId,
      status: {
        state: 'failed',
        timestamp: NORMALIZED,
        message: {
          kind: 'message',
          role: 'agent',
          messageId: NORMALIZED,
          parts: [
            {
              kind: 'text',
              text: 'The agent did not return a valid response.',
            },
          ],
          taskId,
          contextId,
        },
      },
      history: [userMessage],
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

    const finalEvent = normalizeEvent(lastEvent(published))
    expect(finalEvent).toEqual({
      kind: 'task',
      id: taskId,
      contextId,
      status: {
        state: 'failed',
        timestamp: NORMALIZED,
        message: {
          kind: 'message',
          role: 'agent',
          messageId: NORMALIZED,
          parts: [{ kind: 'text', text: 'rate limited' }],
          taskId,
          contextId,
        },
      },
      history: [userMessage],
      metadata: { error_kind: 'usage_limit' },
    })
  })

  it('does not tag a plain failure with error_kind', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockRejectedValue(new Error('boom')),
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

    const finalEvent = normalizeEvent(lastEvent(published))
    expect(finalEvent).toEqual({
      kind: 'task',
      id: taskId,
      contextId,
      status: {
        state: 'failed',
        timestamp: NORMALIZED,
        message: {
          kind: 'message',
          role: 'agent',
          messageId: NORMALIZED,
          parts: [{ kind: 'text', text: 'boom' }],
          taskId,
          contextId,
        },
      },
      history: [userMessage],
    })
  })

  it('publishes periodic working heartbeats while the agent is running', async () => {
    const contextId = `ctx-${randomUUID()}`
    const taskId = `task-${randomUUID()}`
    const userMessage = buildUserMessage(taskId, contextId)
    const agent: MeshiDomainAgentLike = {
      invoke: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                structuredResponse: { status: 'completed', message: 'ok' },
              })
            }, 120)
          }),
      ),
    }
    const executor = createMeshiAgentExecutor({
      agent,
      sql: getTestSql(),
      heartbeatIntervalMs: 20,
    })
    const { bus, published } = buildEventBus()

    await executor.execute(
      new RequestContext(userMessage, taskId, contextId),
      bus,
    )

    const heartbeats = published.filter(
      (event) => event.kind === 'status-update',
    )
    expect(heartbeats.length).toBeGreaterThanOrEqual(2)
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
