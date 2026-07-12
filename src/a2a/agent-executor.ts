import { randomUUID } from 'node:crypto'

import type { Message, Task, TaskState } from '@a2a-js/sdk'
import type {
  AgentExecutor,
  ExecutionEventBus,
  RequestContext,
} from '@a2a-js/sdk/server'

import { withAdvisoryLock } from '@/a2a/advisory-lock'
import { type AgentContentBlock, toAgentContent } from '@/a2a/message-content'
import type { Sql } from '@/db'
import {
  type MeshiAgentResponse,
  meshiAgentResponseSchema,
} from '@/llm/agent/response-schema'

// The minimal surface createMeshiDomainAgent's return value (a langchain
// ReactAgent instance) needs to satisfy. Kept narrow — rather than
// importing that class's full generic-heavy type — so this module and its
// tests don't have to track langchain's agent type machinery, and so tests
// can substitute a plain object instead of building a real agent.
export interface MeshiDomainAgentLike {
  invoke(
    input: {
      messages: Array<{ role: 'user'; content: readonly AgentContentBlock[] }>
    },
    config: { configurable: { thread_id: string } },
  ): Promise<{ structuredResponse?: unknown }>
}

export interface MeshiAgentExecutorOptions {
  readonly agent: MeshiDomainAgentLike
  // Pool to reserve a dedicated connection from for the per-execution
  // session-level advisory lock (see advisory-lock.ts) — pg_advisory_lock
  // must be taken and released on the same physical connection, which the
  // pool's normal round-robin connections can't guarantee.
  readonly sql: Sql
  readonly heartbeatIntervalMs?: number
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000
const USAGE_LIMIT_ERROR_KIND = 'usage_limit'

const STATUS_TO_TASK_STATE: Record<MeshiAgentResponse['status'], TaskState> = {
  completed: 'completed',
  input_required: 'input-required',
  // Deliberately not input-required: silently downgrading an
  // agent-reported error to a follow-up question would hide the failure
  // from the user instead of surfacing it.
  error: 'failed',
}

// LangChain's AsyncCaller (async_caller.ts) classifies a 429 into 'wait'
// (retryable in place), 'stop' (quota exhausted), or 'capacity' (Retry-After
// too long to auto-retry), tagging the error object with `rateLimitType` in
// all three cases. A 'wait' classification alone doesn't throw — but p-retry
// still throws that same tagged error once its own retry budget (separate
// from AsyncCaller's classification) is exhausted, so any error reaching
// this executor with `rateLimitType` set at all is a usage-limit failure
// the automatic retry gave up on, regardless of which value it carries.
const isUsageLimitError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'rateLimitType' in error

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const publishWorkingUpdate = (
  eventBus: ExecutionEventBus,
  taskId: string,
  contextId: string,
): void => {
  eventBus.publish({
    kind: 'status-update',
    taskId,
    contextId,
    status: { state: 'working', timestamp: new Date().toISOString() },
    final: false,
  })
}

const buildAgentMessage = (
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

// Always a full Task event (never a status-update) so it can carry
// metadata.error_kind: ResultManager only copies a status-update event's
// `status` onto the stored task, not its `metadata`. The tradeoff is that a
// `task` event replaces the stored task wholesale rather than merging, so
// unlike a status-update's `status.message`, this constructs the full
// history itself instead of relying on ResultManager to append it.
const buildFinalTask = (
  requestContext: RequestContext,
  state: TaskState,
  message: string,
  errorKind?: string,
): Task => {
  const { taskId, contextId, userMessage, task } = requestContext
  const agentMessage = buildAgentMessage(taskId, contextId, message)
  return {
    kind: 'task',
    id: taskId,
    contextId,
    status: {
      state,
      timestamp: new Date().toISOString(),
      message: agentMessage,
    },
    history: [...(task?.history ?? [userMessage]), agentMessage],
    ...(task?.artifacts !== undefined ? { artifacts: task.artifacts } : {}),
    ...(errorKind !== undefined ? { metadata: { error_kind: errorKind } } : {}),
  }
}

// Runs one agent turn and maps its outcome onto a terminal Task: the
// structured status on success, or a failed task (tagged with error_kind
// for a usage-limit failure) if the agent throws. Pure aside from
// agent.invoke — no event publishing or locking — so status mapping can be
// tested without a database.
export const runAgentTurn = async (
  agent: MeshiDomainAgentLike,
  requestContext: RequestContext,
): Promise<Task> => {
  try {
    const result = await agent.invoke(
      {
        messages: [
          {
            role: 'user',
            content: toAgentContent(requestContext.userMessage),
          },
        ],
      },
      { configurable: { thread_id: requestContext.contextId } },
    )
    const parsed = meshiAgentResponseSchema.safeParse(result.structuredResponse)
    return parsed.success
      ? buildFinalTask(
          requestContext,
          STATUS_TO_TASK_STATE[parsed.data.status],
          parsed.data.message,
        )
      : buildFinalTask(
          requestContext,
          'failed',
          'The agent did not return a valid response.',
        )
  } catch (err) {
    console.error('a2a agent execution failed:', err)
    return buildFinalTask(
      requestContext,
      'failed',
      errorMessage(err),
      isUsageLimitError(err) ? USAGE_LIMIT_ERROR_KIND : undefined,
    )
  }
}

// Bridges A2A tasks to the LangGraph domain agent: serializes same-context
// execution behind a session-level advisory lock, runs the agent with
// contextId as the LangGraph thread_id (so an additional message on the
// same context resumes via the checkpointer), and maps its structured
// status onto the A2A task state.
export const createMeshiAgentExecutor = (
  options: MeshiAgentExecutorOptions,
): AgentExecutor => {
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS

  return {
    async execute(requestContext, eventBus) {
      const { taskId, contextId, userMessage, task } = requestContext

      await withAdvisoryLock(options.sql, contextId, async () => {
        // A brand-new task has no row in the store yet, so it needs a full
        // Task event to seed one (ResultManager.processEvent only applies a
        // status-update to an already-known task). A resumed task already
        // has a row — including this turn's incoming message, appended by
        // the framework before execute() was called — so a status-update
        // is enough, and avoids clobbering that history.
        if (task === undefined) {
          eventBus.publish({
            kind: 'task',
            id: taskId,
            contextId,
            status: {
              state: 'working',
              timestamp: new Date().toISOString(),
            },
            history: [userMessage],
          })
        } else {
          publishWorkingUpdate(eventBus, taskId, contextId)
        }

        // A setInterval callback runs outside execute()'s own call stack, so
        // a throw here can't be caught by the try/finally below it — left
        // unguarded, it would surface as an unhandled exception instead of
        // just costing this one heartbeat tick.
        const heartbeat = setInterval(() => {
          try {
            publishWorkingUpdate(eventBus, taskId, contextId)
          } catch (err) {
            console.error('failed to publish a2a heartbeat update:', err)
          }
        }, heartbeatIntervalMs)
        try {
          eventBus.publish(await runAgentTurn(options.agent, requestContext))
        } finally {
          clearInterval(heartbeat)
        }
      })

      eventBus.finished()
    },

    // The domain agent runs to completion synchronously inside execute();
    // there is no separately-running process to cancel.
    cancelTask() {
      return Promise.resolve()
    },
  }
}
