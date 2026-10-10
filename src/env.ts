export interface Env {
  DATABASE_URL: string
  MCP_LISTEN_ADDR: string
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
    // eslint-disable-next-line no-restricted-syntax -- runs at process bootstrap before any Result-consuming caller exists; callers catch EnvError by type at their own top-level main().catch()
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
    DATABASE_URL: requireString('DATABASE_URL'),
    MCP_LISTEN_ADDR: requireString('MCP_LISTEN_ADDR'),
  }

  if (issues.length > 0) {
    // eslint-disable-next-line no-restricted-syntax -- runs at process bootstrap before any Result-consuming caller exists; callers catch EnvError by type at their own top-level main().catch()
    throw new EnvError(issues)
  }

  return env
}
