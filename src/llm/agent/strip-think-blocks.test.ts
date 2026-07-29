import { describe, expect, it } from 'vitest'

import { stripThinkBlocks } from '#llm/agent/strip-think-blocks'

describe('stripThinkBlocks', () => {
  it('strips a closed think block and trims the remainder', () => {
    expect(
      stripThinkBlocks('<think>\nreasoning here\n</think>\nthe answer'),
    ).toEqual({ text: 'the answer', stripped: true })
  })

  it('strips multiple think blocks', () => {
    expect(
      stripThinkBlocks('<think>first</think>before<think>second</think>after'),
    ).toEqual({ text: 'beforeafter', stripped: true })
  })

  it('leaves text without a think block untouched aside from trimming', () => {
    expect(stripThinkBlocks('just the answer')).toEqual({
      text: 'just the answer',
      stripped: false,
    })
  })

  it('reports not stripped when trimming alone changes nothing meaningful', () => {
    expect(stripThinkBlocks('  just the answer  ')).toEqual({
      text: 'just the answer',
      stripped: false,
    })
  })

  it('strips a think block with no remaining text', () => {
    expect(stripThinkBlocks('<think>only reasoning</think>')).toEqual({
      text: '',
      stripped: true,
    })
  })

  it('matches case-insensitively', () => {
    expect(stripThinkBlocks('<THINK>reasoning</THINK>the answer')).toEqual({
      text: 'the answer',
      stripped: true,
    })
  })

  it('strips an unclosed think block cut off by a token limit', () => {
    expect(stripThinkBlocks('<think>\nreasoning cut off mid-thought')).toEqual({
      text: '',
      stripped: true,
    })
  })

  it('strips an unclosed think block that has text before it', () => {
    expect(stripThinkBlocks('before<think>reasoning cut off')).toEqual({
      text: 'before',
      stripped: true,
    })
  })
})
