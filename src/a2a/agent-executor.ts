import { randomUUID } from 'node:crypto'

import type { Message, Task, TaskState } from '@a2a-js/sdk'
import type {
  AgentExecutor,
  ExecutionEventBus,
  RequestContext,
} from '@a2a-js/sdk/server'
import { captureWithFingerprint } from '@fohte/service-kit/observability'

import { withAdvisoryLock } from '#a2a/advisory-lock'
import { type AgentContentBlock, toAgentContent } from '#a2a/message-content'
import type { Sql } from '#db/index'
import { parseJson } from '#lib/json'
import {
  AGENT_NO_USABLE_REPLY_EVENT,
  AGENT_THINK_BLOCK_LEAKED_EVENT,
  type AgentInvokeMessage,
  type AgentReplyStatus,
  deriveAgentReply,
  findTurnMessages,
} from '#llm/agent/derive-reply'
import { MESHI_AGENT_RECURSION_LIMIT } from '#llm/agent/domain-agent'
import {
  type QueryMealHistoryOutput,
  queryMealHistoryOutputSchema,
  toMealHistoryEntryFields,
} from '#llm/domain-tools/tools/query-meal-history'
import { formatMealHistoryEntries } from '#llm/orchestrator/reply-formatter'
import { createNullLogger, type Logger } from '#logger'

export type { AgentInvokeMessage } from '#llm/agent/derive-reply'

// The minimal surface createMeshiDomainAgent's return value (a langchain
// ReactAgent instance) needs to satisfy. Kept narrow — rather than
// importing that class's full generic-heavy type — so this module and its
// tests don't have to track langchain's agent type machinery, and so tests
// can substitute a plain object instead of building a real agent.
export interface MeshiDomainAgentLike {
  invoke(
    input: {
      messages: Array<{ role: 'user'; content: AgentContentBlock[] }>
    },
    config: { configurable: { thread_id: string }; recursionLimit?: number },
  ): Promise<{
    // With a checkpointer, this is the thread's full accumulated message
    // history, not just this call's new messages (see LangChain's
    // short-term-memory docs) — deriveAgentReply and
    // extractLatestMealHistoryOutput below scope their search to messages
    // after the last human turn to avoid picking up a stale reply or tool
    // result from an earlier turn on the same thread.
    readonly messages: ReadonlyArray<AgentInvokeMessage>
  }>
}

export interface MeshiAgentExecutorOptions {
  readonly agent: MeshiDomainAgentLike
  // Pool to reserve a dedicated connection from for the per-execution
  // session-level advisory lock (see advisory-lock.ts) — pg_advisory_lock
  // must be taken and released on the same physical connection, which the
  // pool's normal round-robin connections can't guarantee.
  readonly sql: Sql
  readonly heartbeatIntervalMs?: number
  readonly logger?: Logger
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000
const USAGE_LIMIT_ERROR_KIND = 'usage_limit'
const NO_USABLE_REPLY_MESSAGE = 'The agent did not return a valid response.'
const NO_USABLE_REPLY_FINGERPRINT = 'a2a.agent-executor.no-usable-reply'

const STATUS_TO_TASK_STATE: Record<AgentReplyStatus, TaskState> = {
  completed: 'completed',
  input_required: 'input-required',
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

const QUERY_MEAL_HISTORY_TOOL_NAME = 'query_meal_history'

// Finds the most recent query_meal_history tool result produced after the
// turn's own human message — not just anywhere in the thread — so a history
// query from an earlier turn on the same context can't leak its itemized
// entries into a later, unrelated turn's response (e.g. recording a meal).
const extractLatestMealHistoryOutput = (
  messages: ReadonlyArray<AgentInvokeMessage> | undefined,
): QueryMealHistoryOutput | null => {
  const turnMessages = findTurnMessages(messages)
  for (let i = turnMessages.length - 1; i >= 0; i -= 1) {
    const message = turnMessages[i]
    if (
      message === undefined ||
      message.getType() !== 'tool' ||
      message.name !== QUERY_MEAL_HISTORY_TOOL_NAME ||
      typeof message.content !== 'string'
    ) {
      continue
    }
    const json = parseJson(message.content)
    if (json.isErr()) continue
    const parsed = queryMealHistoryOutputSchema.safeParse(json.value)
    if (parsed.success) return parsed.data
  }
  return null
}

// Appends a deterministic, code-rendered itemization of this turn's
// query_meal_history entries after the LLM's own message — the LLM's text
// stays free-form (it may still summarize or ask a follow-up), but the
// actual list of what was eaten never depends on the LLM choosing to
// enumerate it faithfully.
const withItemizedMealHistory = (
  message: string,
  output: QueryMealHistoryOutput | null,
): string => {
  if (output === null || output.entries.length === 0) return message
  return `${message}\n\n${formatMealHistoryEntries(output.entries.map(toMealHistoryEntryFields))}`
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
// derived reply's status on success, or a failed task (tagged with
// error_kind for a usage-limit failure) if the agent throws. Pure aside from
// agent.invoke — no event publishing or locking — so status mapping can be
// tested without a database.
export const runAgentTurn = async (
  agent: MeshiDomainAgentLike,
  requestContext: RequestContext,
  logger: Logger = createNullLogger(),
): Promise<Task> => {
  // eslint-disable-next-line no-restricted-syntax -- boundary between LangGraph's throw-based agent.invoke() and this module's Task mapping; the catch below turns any thrown error into a failed Task instead of propagating it
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
      {
        configurable: { thread_id: requestContext.contextId },
        recursionLimit: MESHI_AGENT_RECURSION_LIMIT,
      },
    )
    const reply = deriveAgentReply(result.messages, () => {
      logger.log(AGENT_THINK_BLOCK_LEAKED_EVENT, {
        taskId: requestContext.taskId,
        contextId: requestContext.contextId,
      })
    })
    if (reply === null) {
      logger.log(AGENT_NO_USABLE_REPLY_EVENT, {
        taskId: requestContext.taskId,
        contextId: requestContext.contextId,
      })
      captureWithFingerprint(
        new Error('domain agent turn produced no usable reply'),
        NO_USABLE_REPLY_FINGERPRINT,
        {
          extras: {
            taskId: requestContext.taskId,
            contextId: requestContext.contextId,
          },
        },
      )
      return buildFinalTask(requestContext, 'failed', NO_USABLE_REPLY_MESSAGE)
    }
    return buildFinalTask(
      requestContext,
      STATUS_TO_TASK_STATE[reply.status],
      withItemizedMealHistory(
        reply.text,
        extractLatestMealHistoryOutput(result.messages),
      ),
    )
  } catch (err) {
    console.error('a2a agent execution failed:', err)
    captureWithFingerprint(err, 'a2a.agent-executor.turn-failed', {
      extras: {
        taskId: requestContext.taskId,
        contextId: requestContext.contextId,
      },
    })
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
  const logger = options.logger ?? createNullLogger()

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
          // eslint-disable-next-line no-restricted-syntax -- runs outside execute()'s call stack (see the comment above), so a throw here can't reach the try/finally below and must be swallowed locally
          try {
            publishWorkingUpdate(eventBus, taskId, contextId)
          } catch (err) {
            console.error('failed to publish a2a heartbeat update:', err)
            captureWithFingerprint(err, 'a2a.agent-executor.heartbeat-failed', {
              extras: { taskId, contextId },
            })
          }
        }, heartbeatIntervalMs)
        // eslint-disable-next-line no-restricted-syntax -- runAgentTurn() already converts its own failures into a Task rather than throwing; this try/finally only guarantees clearInterval(heartbeat) runs
        try {
          eventBus.publish(
            await runAgentTurn(options.agent, requestContext, logger),
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
