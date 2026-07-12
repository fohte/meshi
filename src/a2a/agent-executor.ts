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
  // Deliberately not input-required, unlike the a2a-samples LangGraph
  // Currency Agent this pattern is adapted from: silently downgrading an
  // agent-reported error to a follow-up question would hide the failure
  // from the user instead of surfacing it.
  error: 'failed',
}

// LangChain's AsyncCaller (async_caller.ts) classifies a 429 into 'wait'
// (retried in place, never surfaces here), 'stop' (quota exhausted), or
// 'capacity' (Retry-After too long to auto-retry) before giving up, tagging
// the thrown error with `rateLimitType` in the 'stop'/'capacity' cases.
// Both represent a usage-limit failure from this executor's point of view.
const isUsageLimitError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'rateLimitType' in error &&
  (error.rateLimitType === 'stop' || error.rateLimitType === 'capacity')

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
// `status` onto the stored task, not its `metadata`.
const buildFinalTask = (
  requestContext: RequestContext,
  state: TaskState,
  message: string,
  errorKind?: string,
): Task => {
  const { taskId, contextId, userMessage, task } = requestContext
  return {
    kind: 'task',
    id: taskId,
    contextId,
    status: {
      state,
      timestamp: new Date().toISOString(),
      message: buildAgentMessage(taskId, contextId, message),
    },
    history: task?.history ?? [userMessage],
    ...(task?.artifacts !== undefined ? { artifacts: task.artifacts } : {}),
    ...(errorKind !== undefined ? { metadata: { error_kind: errorKind } } : {}),
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

        const heartbeat = setInterval(() => {
          publishWorkingUpdate(eventBus, taskId, contextId)
        }, heartbeatIntervalMs)
        try {
          const result = await options.agent.invoke(
            {
              messages: [
                { role: 'user', content: toAgentContent(userMessage) },
              ],
            },
            { configurable: { thread_id: contextId } },
          )
          const parsed = meshiAgentResponseSchema.safeParse(
            result.structuredResponse,
          )
          eventBus.publish(
            parsed.success
              ? buildFinalTask(
                  requestContext,
                  STATUS_TO_TASK_STATE[parsed.data.status],
                  parsed.data.message,
                )
              : buildFinalTask(
                  requestContext,
                  'failed',
                  'The agent did not return a valid response.',
                ),
          )
        } catch (err) {
          eventBus.publish(
            buildFinalTask(
              requestContext,
              'failed',
              errorMessage(err),
              isUsageLimitError(err) ? USAGE_LIMIT_ERROR_KIND : undefined,
            ),
          )
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
