import { describe, expect, it } from 'vitest'

import { EnvError, loadEnv, requireDatabaseUrl } from '@/env'

const fullSource = {
  OPENCODE_API_KEY: 'k',
  MESHI_LLM_MODEL: 'm',
  DATABASE_URL: 'postgres://localhost/meshi',
  WEB_SEARCH_API_KEY: 'wk',
  MCP_LISTEN_ADDR: '0.0.0.0:8080',
  A2A_AGENT_URL: 'http://meshi:8080/a2a',
  A2A_BEARER_TOKEN: 'secret-token',
  OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'true',
} as const

const fullEnv = {
  OPENCODE_API_KEY: 'k',
  MESHI_LLM_MODEL: 'm',
  DATABASE_URL: 'postgres://localhost/meshi',
  WEB_SEARCH_API_KEY: 'wk',
  MCP_LISTEN_ADDR: '0.0.0.0:8080',
  A2A_AGENT_URL: 'http://meshi:8080/a2a',
  A2A_BEARER_TOKEN: 'secret-token',
  OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: true,
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
    expect(loadEnv(fullSource)).toEqual(fullEnv)
  })

  it('defaults A2A_BEARER_TOKEN to undefined when omitted', () => {
    const { A2A_BEARER_TOKEN: _token, ...rest } = fullSource
    void _token
    expect(loadEnv(rest)).toEqual({ ...fullEnv, A2A_BEARER_TOKEN: undefined })
  })

  it('treats an empty-string A2A_BEARER_TOKEN as undefined', () => {
    expect(loadEnv({ ...fullSource, A2A_BEARER_TOKEN: '' })).toEqual({
      ...fullEnv,
      A2A_BEARER_TOKEN: undefined,
    })
  })

  it('defaults OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT to false when omitted', () => {
    const {
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: _capture,
      ...rest
    } = fullSource
    void _capture
    expect(loadEnv(rest)).toEqual({
      ...fullEnv,
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: false,
    })
  })

  it('treats OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT values other than "true" as false', () => {
    expect(
      loadEnv({
        ...fullSource,
        OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'yes',
      }),
    ).toEqual({
      ...fullEnv,
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: false,
    })
  })

  it('parses OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT case-insensitively', () => {
    expect(
      loadEnv({
        ...fullSource,
        OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'TRUE',
      }),
    ).toEqual({
      ...fullEnv,
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: true,
    })
  })

  it('fails fast listing every missing required key', () => {
    expect(captureIssues(() => loadEnv({}))).toEqual([
      'missing required env: OPENCODE_API_KEY',
      'missing required env: MESHI_LLM_MODEL',
      'missing required env: DATABASE_URL',
      'missing required env: WEB_SEARCH_API_KEY',
      'missing required env: MCP_LISTEN_ADDR',
      'missing required env: A2A_AGENT_URL',
    ])
  })
})

describe('requireDatabaseUrl', () => {
  it('returns DATABASE_URL when set', () => {
    expect(
      requireDatabaseUrl({ DATABASE_URL: 'postgres://localhost/meshi' }),
    ).toBe('postgres://localhost/meshi')
  })

  it('throws EnvError when DATABASE_URL is missing', () => {
    expect(captureIssues(() => requireDatabaseUrl({}))).toEqual([
      'missing required env: DATABASE_URL',
    ])
  })

  it('throws EnvError when DATABASE_URL is an empty string', () => {
    expect(
      captureIssues(() => requireDatabaseUrl({ DATABASE_URL: '' })),
    ).toEqual(['missing required env: DATABASE_URL'])
  })
})
