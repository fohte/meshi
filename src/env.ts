export interface Env {
  OPENCODE_API_KEY: string
  MESHI_LLM_MODEL: string
  MESHI_LLM_VISION_MODEL: string
  MESHI_LLM_LIGHTWEIGHT_MODEL: string
  MESHI_LLM_MAX_TURNS: number
  DATABASE_URL: string
  WEB_SEARCH_API_KEY: string
  MCP_LISTEN_ADDR: string
  // Mirrors the env var used by other OpenTelemetry GenAI instrumentations
  // (e.g. opentelemetry-instrumentation-openai-v2, Elastic's EDOT Node.js SDK)
  // to gate capture of message content, which is opt-in per the GenAI semantic
  // conventions because it may contain PII.
  OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: boolean
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

const missingEnvMessage = (key: string): string =>
  `missing required env: ${key}`

// Standalone from loadEnv/Env: src/db/migrate.ts only ever needs this one
// var and must not fail on the rest of the app's required env.
export const requireDatabaseUrl = (
  source: Readonly<Record<string, string | undefined>> = process.env,
): string => {
  const raw = source['DATABASE_URL']
  if (raw === undefined || raw === '') {
    throw new EnvError([missingEnvMessage('DATABASE_URL')])
  }
  return raw
}

export const loadEnv = (
  source: Readonly<Record<string, string | undefined>> = process.env,
): Env => {
  const issues: string[] = []

  const requireString = (key: keyof Env): string => {
    const raw = source[key]
    if (raw === undefined || raw === '') {
      issues.push(missingEnvMessage(key))
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
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:
      source['OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT'] === 'true',
  }

  if (issues.length > 0) {
    throw new EnvError(issues)
  }

  return env
}
