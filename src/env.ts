export interface Env {
  OPENCODE_API_KEY: string
  MESHI_LLM_MODEL: string
  MESHI_LLM_VISION_MODEL: string
  MESHI_LLM_LIGHTWEIGHT_MODEL: string
  MESHI_LLM_MAX_TURNS: number
  DATABASE_URL: string
  WEB_SEARCH_API_KEY: string
  MCP_LISTEN_ADDR: string
}

const DEFAULT_MAX_TURNS = 12

export class EnvError extends Error {
  constructor(
    public readonly issues: readonly string[],
    message?: string,
  ) {
    super(message ?? `invalid environment: ${issues.join('; ')}`)
    this.name = 'EnvError'
  }
}

export const loadEnv = (
  source: Readonly<Record<string, string | undefined>> = process.env,
): Env => {
  const issues: string[] = []

  const requireString = (key: keyof Env): string => {
    const raw = source[key]
    if (raw === undefined || raw === '') {
      issues.push(`missing required env: ${key}`)
      return ''
    }
    return raw
  }

  const parseMaxTurns = (): number => {
    const raw = source['MESHI_LLM_MAX_TURNS']
    if (raw === undefined) return DEFAULT_MAX_TURNS
    const parsed = Number(raw)
    if (raw === '' || !Number.isInteger(parsed) || parsed <= 0) {
      issues.push(
        `MESHI_LLM_MAX_TURNS must be a positive integer (got: ${raw})`,
      )
      return DEFAULT_MAX_TURNS
    }
    return parsed
  }

  const env: Env = {
    OPENCODE_API_KEY: requireString('OPENCODE_API_KEY'),
    MESHI_LLM_MODEL: requireString('MESHI_LLM_MODEL'),
    MESHI_LLM_VISION_MODEL: requireString('MESHI_LLM_VISION_MODEL'),
    MESHI_LLM_LIGHTWEIGHT_MODEL: requireString('MESHI_LLM_LIGHTWEIGHT_MODEL'),
    MESHI_LLM_MAX_TURNS: parseMaxTurns(),
    DATABASE_URL: requireString('DATABASE_URL'),
    WEB_SEARCH_API_KEY: requireString('WEB_SEARCH_API_KEY'),
    MCP_LISTEN_ADDR: requireString('MCP_LISTEN_ADDR'),
  }

  if (issues.length > 0) {
    throw new EnvError(issues)
  }

  return env
}
