import type { Task, TaskState } from '@a2a-js/sdk'
import type { RequestContext } from '@a2a-js/sdk/server'
import { captureWithFingerprint } from '@fohte/service-kit/observability'
import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base'
import type { HumanMessage } from '@langchain/core/messages'

import {
  extractRegisteredFoodMasters,
  withRegisteredFoodMasterDisclosure,
} from '#a2a/food-master-disclosure'
import {
  extractLatestMealHistoryOutput,
  withItemizedMealHistory,
} from '#a2a/meal-history-itemization'
import { toAgentContent } from '#a2a/message-content'
import { buildAgentMessage } from '#a2a/task-message'
import type { AgentContentBlock } from '#llm/agent/content-block'
import { formatPromptMeta, toHumanMessage } from '#llm/agent/content-block'
import {
  AGENT_NO_USABLE_REPLY_EVENT,
  AGENT_QUESTION_TEXT_MISSING_EVENT,
  AGENT_THINK_BLOCK_LEAKED_EVENT,
  type AgentInvokeMessage,
  type AgentReplyStatus,
  buildNoUsableReplyError,
  deriveAgentReply,
  NO_USABLE_REPLY_MESSAGE,
} from '#llm/agent/derive-reply'
import { MESHI_AGENT_RECURSION_LIMIT } from '#llm/agent/domain-agent'
import { createNullLogger, type Logger } from '#logger'

// The minimal surface createMeshiDomainAgent's return value (a langchain
// ReactAgent instance) needs to satisfy. Kept narrow — rather than
// importing that class's full generic-heavy type — so this module and its
// tests don't have to track langchain's agent type machinery, and so tests
// can substitute a plain object instead of building a real agent.
export interface MeshiDomainAgentLike {
  invoke(
    input: {
      // A real HumanMessage (built via toHumanMessage, not a plain
      // { role, content } literal) is required for @langchain/openai to
      // recognize these as standard v1 content blocks — see the comment on
      // toHumanMessage in content-block.ts.
      messages: HumanMessage[]
    },
    config: {
      configurable: { thread_id: string }
      recursionLimit?: number
      // Reports each tool call the agent starts via LangChain's standard
      // tool-lifecycle callback (see buildProgressCallbacks below) — how
      // this executor learns what step to surface on TaskStatus.message
      // while the turn is still running, rather than only at its end.
      callbacks?: CallbackHandlerMethods[]
    },
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

const USAGE_LIMIT_ERROR_KIND = 'usage_limit'
const NO_USABLE_REPLY_FINGERPRINT = 'a2a.agent-executor.no-usable-reply'

// meshi is @fohte's personal meal management service (see README) — a
// single user in a single timezone — and the A2A transport (unlike the MCP
// tool inputs in domain-agent-orchestrator.ts) carries no per-request
// timezone signal to read instead.
const AGENT_TIMEZONE = 'Asia/Tokyo'

// Grounds the LLM in the actual current date/time so it can resolve a
// relative or year-omitted date the user mentions (e.g. "7/27") into the
// right absolute date instead of guessing — see MESHI_AGENT_SYSTEM_PROMPT's
// instruction for how this line is meant to be read.
const withOccurredAtMeta = (
  content: ReadonlyArray<AgentContentBlock>,
  now: Date,
): AgentContentBlock[] => [
  { type: 'text', text: formatPromptMeta(now, AGENT_TIMEZONE) },
  ...content,
]

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

// Wraps onToolStart as the single LangChain callback handler passed into
// agent.invoke()'s config. LangChain's own CallbackManager already isolates
// each handler (a thrown error here is caught and only console.warn'd — see
// CallbackManager.handleToolStart in @langchain/core's callbacks/manager.js
// — it never reaches back into BaseTool.invoke), so the try/catch below
// isn't guarding the tool call. It exists so a failure here is reported
// through this project's own captureWithFingerprint pipeline with
// taskId/contextId context, the same as every other failure path in this
// file, instead of silently falling back to LangChain's generic warning.
const buildProgressCallbacks = (
  onToolStart: (toolName: string) => void,
  extras: { taskId: string; contextId: string },
): CallbackHandlerMethods[] => [
  {
    handleToolStart: (
      _tool,
      _input,
      _runId,
      _parentRunId,
      _tags,
      _metadata,
      runName,
    ) => {
      if (runName === undefined) return
      // eslint-disable-next-line no-restricted-syntax -- see comment above; not a safety boundary, just routing this failure through captureWithFingerprint instead of LangChain's own console.warn
      try {
        onToolStart(runName)
      } catch (err) {
        console.error('failed to report a2a tool-start progress:', err)
        captureWithFingerprint(err, 'a2a.agent-executor.progress-failed', {
          extras,
        })
      }
    },
  },
]

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
// error_kind for a usage-limit failure) if the agent throws. It does not
// publish events or acquire locks, so task mapping can be tested without a
// database.
export const runAgentTurn = async (
  agent: MeshiDomainAgentLike,
  requestContext: RequestContext,
  // Called with each tool's name as the agent starts running it — omitted
  // entirely (rather than passed as a no-op) so callers that don't report
  // progress don't need to build a fake callbacks array in their invoke.
  onToolStart?: (toolName: string) => void,
  logger: Logger = createNullLogger(),
  now: () => Date = () => new Date(),
): Promise<Task> => {
  // eslint-disable-next-line no-restricted-syntax -- boundary between LangGraph's throw-based agent.invoke() and this module's Task mapping; the catch below turns any thrown error into a failed Task instead of propagating it
  try {
    const result = await agent.invoke(
      {
        messages: [
          toHumanMessage(
            withOccurredAtMeta(
              toAgentContent(requestContext.userMessage),
              now(),
            ),
          ),
        ],
      },
      {
        configurable: { thread_id: requestContext.contextId },
        recursionLimit: MESHI_AGENT_RECURSION_LIMIT,
        ...(onToolStart !== undefined
          ? {
              callbacks: buildProgressCallbacks(onToolStart, {
                taskId: requestContext.taskId,
                contextId: requestContext.contextId,
              }),
            }
          : {}),
      },
    )
    const reply = deriveAgentReply(
      result.messages,
      () => {
        logger.log(AGENT_THINK_BLOCK_LEAKED_EVENT, {
          taskId: requestContext.taskId,
          contextId: requestContext.contextId,
        })
      },
      () => {
        logger.log(AGENT_QUESTION_TEXT_MISSING_EVENT, {
          taskId: requestContext.taskId,
          contextId: requestContext.contextId,
        })
      },
    )
    if (reply === null) {
      logger.log(AGENT_NO_USABLE_REPLY_EVENT, {
        taskId: requestContext.taskId,
        contextId: requestContext.contextId,
      })
      captureWithFingerprint(
        buildNoUsableReplyError(),
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
      withRegisteredFoodMasterDisclosure(
        withItemizedMealHistory(
          reply.text,
          extractLatestMealHistoryOutput(result.messages),
        ),
        extractRegisteredFoodMasters(result.messages),
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
