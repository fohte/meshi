import { describe, expect, it } from 'vitest'

import { EnvError, loadEnv } from '@/env'

const fullSource = {
  OPENCODE_API_KEY: 'k',
  MESHI_LLM_MODEL: 'm',
  MESHI_LLM_VISION_MODEL: 'vm',
  MESHI_LLM_LIGHTWEIGHT_MODEL: 'lm',
  MESHI_LLM_MAX_TURNS: '8',
  DATABASE_URL: 'postgres://localhost/meshi',
  WEB_SEARCH_API_KEY: 'wk',
  MCP_LISTEN_ADDR: '0.0.0.0:8080',
  OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'true',
} as const

const captureIssues = (run: () => unknown): readonly string[] => {
  try {
    run()
  } catch (err) {
    if (err instanceof EnvError) return err.issues
    throw err
  }
  throw new Error('expected loadEnv to throw')
}

describe('loadEnv', () => {
  it('parses a complete environment', () => {
    expect(loadEnv(fullSource)).toEqual({
      OPENCODE_API_KEY: 'k',
      MESHI_LLM_MODEL: 'm',
      MESHI_LLM_VISION_MODEL: 'vm',
      MESHI_LLM_LIGHTWEIGHT_MODEL: 'lm',
      MESHI_LLM_MAX_TURNS: 8,
      DATABASE_URL: 'postgres://localhost/meshi',
      WEB_SEARCH_API_KEY: 'wk',
      MCP_LISTEN_ADDR: '0.0.0.0:8080',
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: true,
    })
  })

  it('defaults MESHI_LLM_MAX_TURNS to 12 when omitted', () => {
    const { MESHI_LLM_MAX_TURNS: _max, ...rest } = fullSource
    void _max
    expect(loadEnv(rest).MESHI_LLM_MAX_TURNS).toBe(12)
  })

  it('defaults OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT to false when omitted', () => {
    const {
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: _capture,
      ...rest
    } = fullSource
    void _capture
    expect(
      loadEnv(rest).OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT,
    ).toBe(false)
  })

  it('treats OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT values other than "true" as false', () => {
    expect(
      loadEnv({
        ...fullSource,
        OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'yes',
      }).OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT,
    ).toBe(false)
  })

  it('fails fast listing every missing required key', () => {
    expect(captureIssues(() => loadEnv({}))).toEqual([
      'missing required env: OPENCODE_API_KEY',
      'missing required env: MESHI_LLM_MODEL',
      'missing required env: MESHI_LLM_VISION_MODEL',
      'missing required env: MESHI_LLM_LIGHTWEIGHT_MODEL',
      'missing required env: DATABASE_URL',
      'missing required env: WEB_SEARCH_API_KEY',
      'missing required env: MCP_LISTEN_ADDR',
    ])
  })

  it('rejects empty-string MESHI_LLM_MAX_TURNS', () => {
    expect(
      captureIssues(() => loadEnv({ ...fullSource, MESHI_LLM_MAX_TURNS: '' })),
    ).toEqual(['MESHI_LLM_MAX_TURNS must be a positive integer (got: )'])
  })

  it('rejects non-positive-integer MESHI_LLM_MAX_TURNS', () => {
    expect(
      captureIssues(() => loadEnv({ ...fullSource, MESHI_LLM_MAX_TURNS: '0' })),
    ).toEqual(['MESHI_LLM_MAX_TURNS must be a positive integer (got: 0)'])
  })
})
