import type { AgentExecutor, ExecutionEventBus } from '@a2a-js/sdk/server'
import { captureWithFingerprint } from '@fohte/service-kit/observability'

import { withAdvisoryLock } from '#a2a/advisory-lock'
import { type MeshiDomainAgentLike, runAgentTurn } from '#a2a/run-agent-turn'
import { buildAgentMessage } from '#a2a/task-message'
import type { Sql } from '#db/index'
import type { DomainToolName } from '#llm/domain-tools/types'
import { createNullLogger, type Logger } from '#logger'

export interface MeshiAgentExecutorOptions {
  readonly agent: MeshiDomainAgentLike
  // Pool to reserve a dedicated connection from for the per-execution
  // session-level advisory lock (see advisory-lock.ts) — pg_advisory_lock
  // must be taken and released on the same physical connection, which the
  // pool's normal round-robin connections can't guarantee.
  readonly sql: Sql
  readonly heartbeatIntervalMs?: number
  readonly logger?: Logger
  // Overridable for tests; defaults to the real wall clock and is read once
  // per turn to ground the LLM's date/time resolution.
  readonly now?: () => Date
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000

// `message` carries the human-readable step currently in progress (see
// TOOL_PROGRESS_MESSAGES below) — omitted while nothing is known yet (the
// initial seed and the very first heartbeat before any tool has started).
const publishWorkingUpdate = (
  eventBus: ExecutionEventBus,
  taskId: string,
  contextId: string,
  message?: string,
): void => {
  eventBus.publish({
    kind: 'status-update',
    taskId,
    contextId,
    status: {
      state: 'working',
      timestamp: new Date().toISOString(),
      ...(message !== undefined
        ? { message: buildAgentMessage(taskId, contextId, message) }
        : {}),
    },
    final: false,
  })
}

// Human-readable step text shown on TaskStatus.message while each domain
// tool (src/llm/domain-tools/tools/*.ts) is running. Keyed by DomainToolName
// so a tool rename fails this table to compile instead of silently going
// unmapped. meshi_agent_response (the synthetic structured-output tool from
// response-schema.ts, not a DomainTool) is deliberately not listed here: it
// reports the turn's outcome, not an in-progress step, and runAgentTurn
// publishes that outcome directly once it returns.
const TOOL_PROGRESS_MESSAGES: Record<DomainToolName, string> = {
  search_food_master: 'Looking up the food in the food database...',
  web_search: 'Searching the web for food information...',
  register_food_master: 'Registering a new food entry...',
  register_food_master_from_composition:
    'Registering a new food entry from the composition table...',
  merge_food_master: 'Merging duplicate food entries...',
  record_meal_log: 'Recording your meal...',
  update_meal_log: 'Updating your meal record...',
  record_meal_skip: 'Recording that you skipped a meal...',
  cancel_meal_skip: 'Undoing the recorded meal skip...',
  query_meal_history: 'Looking up your meal history...',
  get_user_profile: 'Reading your profile...',
  update_user_profile: 'Updating your profile...',
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
  const now = options.now ?? (() => new Date())

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

        // Updated as each tool call starts (see TOOL_PROGRESS_MESSAGES) and
        // read by both the immediate publish below and every subsequent
        // heartbeat tick, so a heartbeat firing between two tool calls still
        // republishes the most recently known step rather than reverting to
        // no message. Tracks only the single most recently started tool, not
        // a set of in-flight calls: if the model's tool_calls for a turn run
        // concurrently (LangGraph's ToolNode dispatches multiple tool_calls
        // from one AI message in parallel), a slower earlier-started tool's
        // text can be overwritten by a faster, later-started one until the
        // next tool call or the turn's final response. Accepted for now —
        // this only affects which in-progress step is shown, never the
        // actual final result.
        let latestProgressMessage: string | undefined
        const onToolStart = (toolName: string): void => {
          if (!(toolName in TOOL_PROGRESS_MESSAGES)) return
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the `in` check above proves toolName is one of TOOL_PROGRESS_MESSAGES's DomainToolName keys; Record<K, V> has no index signature for a plain string, so TS can't narrow this on its own
          const message = TOOL_PROGRESS_MESSAGES[toolName as DomainToolName]
          latestProgressMessage = message
          publishWorkingUpdate(eventBus, taskId, contextId, message)
        }

        // A setInterval callback runs outside execute()'s own call stack, so
        // a throw here can't be caught by the try/finally below it — left
        // unguarded, it would surface as an unhandled exception instead of
        // just costing this one heartbeat tick.
        const heartbeat = setInterval(() => {
          // eslint-disable-next-line no-restricted-syntax -- runs outside execute()'s call stack (see the comment above), so a throw here can't reach the try/finally below and must be swallowed locally
          try {
            publishWorkingUpdate(
              eventBus,
              taskId,
              contextId,
              latestProgressMessage,
            )
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
            await runAgentTurn(
              options.agent,
              requestContext,
              onToolStart,
              logger,
              now,
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
