export interface Env {
  OPENCODE_API_KEY: string
  MESHI_LLM_MODEL: string
  DATABASE_URL: string
  WEB_SEARCH_API_KEY: string
  MCP_LISTEN_ADDR: string
  // The A2A JSON-RPC endpoint's externally-reachable URL, embedded verbatim
  // as the Agent Card's `url` field (see src/a2a/agent-card.ts).
  A2A_AGENT_URL: string
  // In-cluster bearer auth for the A2A endpoint (src/a2a/hono-bridge.ts);
  // unset disables it.
  A2A_BEARER_TOKEN: string | undefined
  // Mirrors the env var used by other OpenTelemetry GenAI instrumentations
  // (e.g. opentelemetry-instrumentation-openai-v2, Elastic's EDOT Node.js SDK)
  // to gate capture of message content, which is opt-in per the GenAI semantic
  // conventions because it may contain PII.
  OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: boolean
}

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

  const env: Env = {
    OPENCODE_API_KEY: requireString('OPENCODE_API_KEY'),
    MESHI_LLM_MODEL: requireString('MESHI_LLM_MODEL'),
    DATABASE_URL: requireString('DATABASE_URL'),
    WEB_SEARCH_API_KEY: requireString('WEB_SEARCH_API_KEY'),
    MCP_LISTEN_ADDR: requireString('MCP_LISTEN_ADDR'),
    A2A_AGENT_URL: requireString('A2A_AGENT_URL'),
    A2A_BEARER_TOKEN:
      source['A2A_BEARER_TOKEN'] === ''
        ? undefined
        : source['A2A_BEARER_TOKEN'],
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:
      source[
        'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT'
      ]?.toLowerCase() === 'true',
  }

  if (issues.length > 0) {
    throw new EnvError(issues)
  }

  return env
}
