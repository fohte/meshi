import { captureWithFingerprint } from '@fohte/service-kit/observability'
import { AIMessage } from '@langchain/core/messages'
import { fakeModel } from 'langchain'
import { describe, expect, it, vi } from 'vitest'

import { FALLBACK_QUESTION_TEXT } from '#llm/agent/fallback-question'
import { REQUEST_USER_INPUT_TOOL_NAME } from '#llm/agent/request-user-input-tool'
import type { DomainToolsRegistry } from '#llm/domain-tools/registry'
import type { DomainTool, DomainToolName } from '#llm/domain-tools/types'
import { err, ok } from '#llm/domain-tools/types'
import { createDomainAgentOrchestrator } from '#llm/orchestrator/domain-agent-orchestrator'
import type { MealRecordResult } from '#llm/orchestrator/types'
import type { Logger } from '#logger'
import { scriptedDomainAgentModel } from '#test/scripted-domain-agent-model'

vi.mock('@fohte/service-kit/observability', () => ({
  captureWithFingerprint: vi.fn(),
}))

const stubRegistry = (
  tools: ReadonlyArray<DomainTool>,
): DomainToolsRegistry => ({
  list: () => tools,
  get: (name) => tools.find((t) => t.name === name),
  toLlmSchemas: () =>
    tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  executeToolUse: () => {
    throw new Error('not used by createDomainAgentOrchestrator')
  },
})

const stubTool = (
  name: DomainToolName,
  execute: DomainTool['execute'],
): DomainTool => ({
  name,
  description: `stub ${name}`,
  inputSchema: { type: 'object' },
  execute,
})

// Mirrors the prefix domain-agent-orchestrator.ts's runTurn adds in front of
// agent.invoke()'s rejection reason; the tail after it is langchain's
// fakeModel test double's own wording, not this repo's, so it gets replaced
// with a placeholder before comparison.
const ORCHESTRATOR_INVOKE_ERROR_PREFIX = 'meshi: domain agent turn failed:'

const normalizeInvokeErrorMessage = (message: string): string =>
  message.startsWith(ORCHESTRATOR_INVOKE_ERROR_PREFIX)
    ? `${ORCHESTRATOR_INVOKE_ERROR_PREFIX} <error>`
    : message

const normalizeInvokeError = (result: MealRecordResult): MealRecordResult => ({
  ...result,
  summaryText: normalizeInvokeErrorMessage(result.summaryText),
  error:
    result.error === null
      ? null
      : {
          ...result.error,
          message: normalizeInvokeErrorMessage(result.error.message),
        },
})

const expectedDeadlineMealRecord = {
  recorded: [],
  candidates: [],
  hasEstimatedValues: false,
  summaryText: '処理が時間内に終わらなかったため中断しました。',
  error: {
    kind: 'deadline_exceeded',
    message: '処理が時間内に終わらなかったため中断しました。',
  },
} satisfies MealRecordResult

describe('createDomainAgentOrchestrator', () => {
  it('stops a turn when its abort signal is already expired', async () => {
    const controller = new AbortController()
    controller.abort(
      new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
      ),
    )
    const orchestrator = createDomainAgentOrchestrator({
      model: fakeModel().respond(new AIMessage('final answer')),
      registry: stubRegistry([]),
    })

    const result = await orchestrator.recordFromText(
      { text: 'meal description' },
      controller.signal,
    )

    expect(result).toEqual(expectedDeadlineMealRecord)
  })

  it('returns a deadline error when the request is canceled', async () => {
    const controller = new AbortController()
    controller.abort()
    const orchestrator = createDomainAgentOrchestrator({
      model: fakeModel().respond(new AIMessage('final answer')),
      registry: stubRegistry([]),
    })

    const result = await orchestrator.recordFromText(
      { text: 'meal description' },
      controller.signal,
    )

    expect(result).toEqual(expectedDeadlineMealRecord)
  })

  it('returns a deadline error when a model request times out', async () => {
    const orchestrator = createDomainAgentOrchestrator({
      model: fakeModel().alwaysThrow(
        new DOMException(
          'The operation was aborted due to timeout',
          'TimeoutError',
        ),
      ),
      registry: stubRegistry([]),
    })

    const result = await orchestrator.recordFromText({
      text: 'meal description',
    })

    expect(result).toEqual(expectedDeadlineMealRecord)
  })

  it('returns a deadline error when the OpenAI client reports a connection timeout', async () => {
    const timeoutError = new Error('request timed out')
    timeoutError.name = 'APIConnectionTimeoutError'
    const orchestrator = createDomainAgentOrchestrator({
      model: fakeModel().alwaysThrow(timeoutError),
      registry: stubRegistry([]),
    })

    const result = await orchestrator.recordFromText({
      text: 'meal description',
    })

    expect(result).toEqual(expectedDeadlineMealRecord)
  })

  describe('recordFromText', () => {
    it('extracts a recorded meal from the record_meal_log call', async () => {
      const registry = stubRegistry([
        stubTool('record_meal_log', () =>
          Promise.resolve(
            ok({
              meal_log_id: 'ml_1',
              nutrition: { energy_kcal: 336 },
              is_estimated: false,
            }),
          ),
        ),
      ])
      const orchestrator = createDomainAgentOrchestrator({
        model: scriptedDomainAgentModel(
          [{ name: 'record_meal_log', args: { food_master_id: 'fm_rice' } }],
          { status: 'completed', message: '白米 200g を記録しました。' },
        ),
        registry,
      })

      const result = await orchestrator.recordFromText({ text: '白米 200g' })

      expect(result).toEqual({
        recorded: [
          {
            mealLogId: 'ml_1',
            foodMasterId: 'fm_rice',
            nutrition: { energy_kcal: 336 },
            isEstimated: false,
          },
        ],
        candidates: [],
        hasEstimatedValues: false,
        summaryText: '白米 200g を記録しました。',
        error: null,
      })
    })

    it('surfaces the last search_food_master candidates when nothing was recorded', async () => {
      const registry = stubRegistry([
        stubTool('search_food_master', () =>
          Promise.resolve(
            ok({
              candidates: [
                {
                  food_master_id: 'fm_1',
                  composition_code: null,
                  name: 'salmon sushi',
                  is_estimated: false,
                  score: 0.5,
                  reason: 'fuzzy_name',
                },
              ],
            }),
          ),
        ),
      ])
      const orchestrator = createDomainAgentOrchestrator({
        model: scriptedDomainAgentModel(
          [{ name: 'search_food_master', args: { query: 'salmon' } }],
          {
            status: 'input_required',
            message: 'どの salmon メニューか特定できませんでした。',
          },
        ),
        registry,
      })

      const result = await orchestrator.recordFromText({ text: 'salmon' })

      expect(result).toEqual({
        recorded: [],
        candidates: [
          {
            foodMasterId: 'fm_1',
            compositionCode: null,
            name: 'salmon sushi',
            isEstimated: false,
            score: 0.5,
            reason: 'fuzzy_name',
          },
        ],
        hasEstimatedValues: false,
        summaryText: 'どの salmon メニューか特定できませんでした。',
        error: null,
      })
    })

    it('surfaces a later item’s candidates alongside an earlier item already recorded in the same turn', async () => {
      const registry = stubRegistry([
        stubTool('record_meal_log', () =>
          Promise.resolve(
            ok({
              meal_log_id: 'ml_1',
              nutrition: { energy_kcal: 336 },
              is_estimated: false,
            }),
          ),
        ),
        stubTool('search_food_master', () =>
          Promise.resolve(
            ok({
              candidates: [
                {
                  food_master_id: 'fm_2',
                  composition_code: null,
                  name: 'salmon sushi',
                  is_estimated: false,
                  score: 0.5,
                  reason: 'fuzzy_name',
                },
              ],
            }),
          ),
        ),
      ])
      const orchestrator = createDomainAgentOrchestrator({
        model: scriptedDomainAgentModel(
          [
            { name: 'record_meal_log', args: { food_master_id: 'fm_rice' } },
            { name: 'search_food_master', args: { query: 'salmon' } },
          ],
          {
            status: 'input_required',
            message: '白米は記録しました。salmon はどのメニューですか？',
          },
        ),
        registry,
      })

      const result = await orchestrator.recordFromText({
        text: '白米 200g と salmon を食べた',
      })

      expect(result).toEqual({
        recorded: [
          {
            mealLogId: 'ml_1',
            foodMasterId: 'fm_rice',
            nutrition: { energy_kcal: 336 },
            isEstimated: false,
          },
        ],
        candidates: [
          {
            foodMasterId: 'fm_2',
            compositionCode: null,
            name: 'salmon sushi',
            isEstimated: false,
            score: 0.5,
            reason: 'fuzzy_name',
          },
        ],
        hasEstimatedValues: false,
        summaryText: '白米は記録しました。salmon はどのメニューですか？',
        error: null,
      })
    })

    // The agent has no way to self-report an error status: a domain tool
    // failure only surfaces as an OrchestratorError via the "no usable
    // reply" guard (see below) or a thrown agent.invoke(), never because the
    // model narrated a failure in its own reply text.
    it('treats a narrated tool failure as completed, since the agent has no way to self-report an error', async () => {
      const registry = stubRegistry([
        stubTool('record_meal_log', () =>
          Promise.resolve(
            err({ code: 'food_master_not_found', message: 'not found' }),
          ),
        ),
      ])
      const orchestrator = createDomainAgentOrchestrator({
        model: scriptedDomainAgentModel(
          [{ name: 'record_meal_log', args: { food_master_id: 'fm_missing' } }],
          { status: 'completed', message: 'That food could not be found.' },
        ),
        registry,
      })

      const result = await orchestrator.recordFromText({ text: 'unknown' })

      expect(result).toEqual({
        recorded: [],
        candidates: [],
        hasEstimatedValues: false,
        summaryText: 'That food could not be found.',
        error: null,
      })
    })

    it('surfaces an item_conversation_failed OrchestratorError when the agent produces no usable reply', async () => {
      const registry = stubRegistry([])
      const orchestrator = createDomainAgentOrchestrator({
        model: fakeModel().respond(new AIMessage('')),
        registry,
      })

      const result = await orchestrator.recordFromText({ text: 'hello' })

      expect(result).toEqual({
        recorded: [],
        candidates: [],
        hasEstimatedValues: false,
        summaryText: 'The agent did not return a valid response.',
        error: {
          kind: 'item_conversation_failed',
          message: 'The agent did not return a valid response.',
        },
      })
    })

    it('logs a warn event when the agent produces no usable reply', async () => {
      const registry = stubRegistry([])
      const logs: Array<{
        event: string
        payload: Readonly<Record<string, unknown>> | undefined
      }> = []
      const logger: Logger = {
        log: (event, payload) => logs.push({ event, payload }),
      }
      const orchestrator = createDomainAgentOrchestrator({
        model: fakeModel().respond(new AIMessage('')),
        registry,
        logger,
      })

      await orchestrator.recordFromText({ text: 'hello' })

      expect(logs).toEqual([
        { event: 'meshi.agent_no_usable_reply', payload: {} },
      ])
    })

    it('reports to Sentry when the agent produces no usable reply', async () => {
      const registry = stubRegistry([])
      const orchestrator = createDomainAgentOrchestrator({
        model: fakeModel().respond(new AIMessage('')),
        registry,
      })

      await orchestrator.recordFromText({ text: 'hello' })

      expect(captureWithFingerprint).toHaveBeenCalledExactlyOnceWith(
        expect.any(Error),
        'llm.orchestrator.no-usable-reply',
      )
    })

    it('falls back to the request_user_input question argument when the reply text is empty', async () => {
      const registry = stubRegistry([])
      const orchestrator = createDomainAgentOrchestrator({
        model: fakeModel().respond(
          new AIMessage({
            content: '',
            tool_calls: [
              {
                name: REQUEST_USER_INPUT_TOOL_NAME,
                args: {
                  question: 'どの salmon メニューか特定できませんでした。',
                },
                id: 'call_1',
                type: 'tool_call',
              },
            ],
          }),
        ),
        registry,
      })

      const result = await orchestrator.recordFromText({ text: 'salmon' })

      expect(result).toEqual({
        recorded: [],
        candidates: [],
        hasEstimatedValues: false,
        summaryText: 'どの salmon メニューか特定できませんでした。',
        error: null,
      })
    })

    it('falls back to a hardcoded question when request_user_input has neither reply text nor a question argument', async () => {
      const registry = stubRegistry([])
      const orchestrator = createDomainAgentOrchestrator({
        model: fakeModel().respond(
          new AIMessage({
            content: '',
            tool_calls: [
              {
                name: REQUEST_USER_INPUT_TOOL_NAME,
                args: {},
                id: 'call_1',
                type: 'tool_call',
              },
            ],
          }),
        ),
        registry,
      })

      const result = await orchestrator.recordFromText({ text: 'salmon' })

      expect(result).toEqual({
        recorded: [],
        candidates: [],
        hasEstimatedValues: false,
        summaryText: FALLBACK_QUESTION_TEXT,
        error: null,
      })
    })

    it('logs an event when request_user_input is called with no usable reply text', async () => {
      const registry = stubRegistry([])
      const logs: Array<{
        event: string
        payload: Readonly<Record<string, unknown>> | undefined
      }> = []
      const logger: Logger = {
        log: (event, payload) => logs.push({ event, payload }),
      }
      const orchestrator = createDomainAgentOrchestrator({
        model: fakeModel().respond(
          new AIMessage({
            content: '',
            tool_calls: [
              {
                name: REQUEST_USER_INPUT_TOOL_NAME,
                args: {},
                id: 'call_1',
                type: 'tool_call',
              },
            ],
          }),
        ),
        registry,
        logger,
      })

      await orchestrator.recordFromText({ text: 'salmon' })

      expect(logs).toEqual([
        { event: 'meshi.agent_question_text_missing', payload: {} },
      ])
    })

    it('strips a leaked think block from the reply summary text', async () => {
      const registry = stubRegistry([])
      const orchestrator = createDomainAgentOrchestrator({
        model: fakeModel().respond(
          new AIMessage('<think>reasoning</think>final answer'),
        ),
        registry,
      })

      const result = await orchestrator.recordFromText({ text: 'hello' })

      expect(result).toEqual({
        recorded: [],
        candidates: [],
        hasEstimatedValues: false,
        summaryText: 'final answer',
        error: null,
      })
    })

    it('logs a warn event when a think block leaks into the reply', async () => {
      const registry = stubRegistry([])
      const logs: Array<{
        event: string
        payload: Readonly<Record<string, unknown>> | undefined
      }> = []
      const logger: Logger = {
        log: (event, payload) => logs.push({ event, payload }),
      }
      const orchestrator = createDomainAgentOrchestrator({
        model: fakeModel().respond(
          new AIMessage('<think>reasoning</think>final answer'),
        ),
        registry,
        logger,
      })

      await orchestrator.recordFromText({ text: 'hello' })

      expect(logs).toEqual([
        { event: 'meshi.agent_think_block_leaked', payload: {} },
      ])
    })

    it('reports to Sentry when agent.invoke() rejects', async () => {
      const registry = stubRegistry([])
      const orchestrator = createDomainAgentOrchestrator({
        model: fakeModel().alwaysThrow(new Error('transport failure')),
        registry,
      })

      await orchestrator.recordFromText({ text: 'hello' })

      expect(captureWithFingerprint).toHaveBeenCalledExactlyOnceWith(
        expect.any(Error),
        'llm.orchestrator.agent-invoke-failed',
      )
    })

    it('keeps invocations already recorded before agent.invoke() rejects', async () => {
      const registry = stubRegistry([
        stubTool('record_meal_log', () =>
          Promise.resolve(
            ok({
              meal_log_id: 'ml_1',
              nutrition: { energy_kcal: 336 },
              is_estimated: false,
            }),
          ),
        ),
      ])
      const model = scriptedDomainAgentModel([
        { name: 'record_meal_log', args: { food_master_id: 'fm_rice' } },
      ])
      const orchestrator = createDomainAgentOrchestrator({ model, registry })

      const result = await orchestrator.recordFromText({ text: '白米 200g' })

      expect(normalizeInvokeError(result)).toEqual({
        recorded: [
          {
            mealLogId: 'ml_1',
            foodMasterId: 'fm_rice',
            nutrition: { energy_kcal: 336 },
            isEstimated: false,
          },
        ],
        candidates: [],
        hasEstimatedValues: false,
        summaryText: `${ORCHESTRATOR_INVOKE_ERROR_PREFIX} <error>`,
        error: {
          kind: 'item_conversation_failed',
          message: `${ORCHESTRATOR_INVOKE_ERROR_PREFIX} <error>`,
        },
      })
    })
  })

  describe('recordFromImage', () => {
    it('builds a MealRecordResult from an image + hint text input', async () => {
      const registry = stubRegistry([
        stubTool('record_meal_log', () =>
          Promise.resolve(
            ok({
              meal_log_id: 'ml_img_1',
              nutrition: { energy_kcal: 252 },
              is_estimated: false,
            }),
          ),
        ),
      ])
      const orchestrator = createDomainAgentOrchestrator({
        model: scriptedDomainAgentModel(
          [{ name: 'record_meal_log', args: { food_master_id: 'fm_rice' } }],
          { status: 'completed', message: '写真から白米を記録しました。' },
        ),
        registry,
      })

      const result = await orchestrator.recordFromImage({
        image: { mimeType: 'image/png', base64: 'aGVsbG8=' },
        hintText: '夕食',
      })

      expect(result).toEqual({
        recorded: [
          {
            mealLogId: 'ml_img_1',
            foodMasterId: 'fm_rice',
            nutrition: { energy_kcal: 252 },
            isEstimated: false,
          },
        ],
        candidates: [],
        hasEstimatedValues: false,
        summaryText: '写真から白米を記録しました。',
        error: null,
      })
    })
  })
})
