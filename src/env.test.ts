import { describe, expect, it } from 'vitest'

import { EnvError, loadEnv, requireDatabaseUrl } from '#env'

const fullSource = {
  DATABASE_URL: 'postgres://localhost/meshi',
  MCP_LISTEN_ADDR: '0.0.0.0:8080',
} as const

const fullEnv = {
  DATABASE_URL: 'postgres://localhost/meshi',
  MCP_LISTEN_ADDR: '0.0.0.0:8080',
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

  it('fails fast listing every missing required key', () => {
    expect(captureIssues(() => loadEnv({}))).toEqual([
      'missing required env: DATABASE_URL',
      'missing required env: MCP_LISTEN_ADDR',
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
