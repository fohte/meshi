import { describe, expect, it, vi } from 'vitest'

import type { AgentInvokeMessage } from '#llm/agent/derive-reply'
import { deriveAgentReply, findTurnMessages } from '#llm/agent/derive-reply'
import { REQUEST_USER_INPUT_TOOL_NAME } from '#llm/agent/request-user-input-tool'

const buildMessage = (
  type: string,
  overrides: {
    name?: string
    content?: unknown
    text?: string
    toolCalls?: ReadonlyArray<{ name: string }>
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

describe('findTurnMessages', () => {
  it('returns an empty array when messages is undefined', () => {
    expect(findTurnMessages(undefined)).toEqual([])
  })

  it('returns an empty array when there is no human message', () => {
    expect(findTurnMessages([buildMessage('ai', { text: 'hi' })])).toEqual([])
  })

  it('returns only the messages after the last human message', () => {
    const tail = [buildMessage('ai', { text: 'second' })]
    expect(
      findTurnMessages([
        buildMessage('human'),
        buildMessage('ai', { text: 'first' }),
        buildMessage('human'),
        ...tail,
      ]),
    ).toEqual(tail)
  })
})

describe('deriveAgentReply', () => {
  it('returns null when there are no messages', () => {
    const onLeak = vi.fn()
    expect(deriveAgentReply(undefined, onLeak)).toBeNull()
    expect(onLeak).not.toHaveBeenCalled()
  })

  it('returns null when the turn has no AI message', () => {
    const onLeak = vi.fn()
    expect(deriveAgentReply([buildMessage('human')], onLeak)).toBeNull()
  })

  it('returns null when the last AI message has no usable text', () => {
    const onLeak = vi.fn()
    const result = deriveAgentReply(
      [buildMessage('human'), buildMessage('ai', { text: '   ' })],
      onLeak,
    )
    expect(result).toBeNull()
  })

  it('returns a completed reply for a plain AI message with no tool calls', () => {
    const onLeak = vi.fn()
    const result = deriveAgentReply(
      [buildMessage('human'), buildMessage('ai', { text: 'all done' })],
      onLeak,
    )
    expect(result).toEqual({ status: 'completed', text: 'all done' })
    expect(onLeak).not.toHaveBeenCalled()
  })

  it('returns an input_required reply when the last AI message calls request_user_input', () => {
    const onLeak = vi.fn()
    const result = deriveAgentReply(
      [
        buildMessage('human'),
        buildMessage('ai', {
          text: 'Which food did you mean?',
          toolCalls: [{ name: REQUEST_USER_INPUT_TOOL_NAME }],
        }),
      ],
      onLeak,
    )
    expect(result).toEqual({
      status: 'input_required',
      text: 'Which food did you mean?',
    })
  })

  it('does not treat a call to an unrelated tool as input_required', () => {
    const onLeak = vi.fn()
    const result = deriveAgentReply(
      [
        buildMessage('human'),
        buildMessage('ai', {
          text: 'Recorded your meal.',
          toolCalls: [{ name: 'record_meal_log' }],
        }),
      ],
      onLeak,
    )
    expect(result).toEqual({ status: 'completed', text: 'Recorded your meal.' })
  })

  it('scopes to the last human turn, ignoring an earlier AI reply', () => {
    const onLeak = vi.fn()
    const result = deriveAgentReply(
      [
        buildMessage('human'),
        buildMessage('ai', { text: 'earlier reply' }),
        buildMessage('human'),
        buildMessage('ai', { text: 'latest reply' }),
      ],
      onLeak,
    )
    expect(result).toEqual({ status: 'completed', text: 'latest reply' })
  })

  it('strips a leaked think block and reports it via the callback', () => {
    const onLeak = vi.fn()
    const result = deriveAgentReply(
      [
        buildMessage('human'),
        buildMessage('ai', {
          text: '<think>reasoning</think>the answer',
        }),
      ],
      onLeak,
    )
    expect(result).toEqual({ status: 'completed', text: 'the answer' })
    expect(onLeak).toHaveBeenCalledOnce()
  })
})
