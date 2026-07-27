// Must run before any instrumented module is imported, otherwise
// @opentelemetry/auto-instrumentations-node cannot patch them — hence
// `import './bootstrap'` as the very first statement of `index.ts`.
// This alone is not enough for built-in modules like `http`, though — see
<<<<<<< before updating
// otel-register.mjs, registered via `--import` in the `start`/`dev` scripts
// and the Dockerfile's `CMD`, for why.
||||||| last update
// @opentelemetry/auto-instrumentations-node cannot patch them. Either
// `import './bootstrap'` as the very first statement of the entrypoint,
// or pre-load with `node --import` (ESM) / `--require` (CJS).
=======
// otel-register.mjs: it must be preloaded via `node --import` before this
// file (or anything else) is imported, or `http.Server` is never patched.
>>>>>>> after updating
import {
  initObservability,
  isObservabilityConfigured,
  type ObservabilityHandle,
} from '@fohte/service-kit/observability'

import { createJsonStdoutLogger } from '#logger'

const jsonLogger = createJsonStdoutLogger()
const observabilityLogger = {
  info: (payload: Record<string, unknown>, msg: string) => {
    jsonLogger.log(msg, payload)
  },
  warn: (payload: Record<string, unknown>, msg: string) => {
    jsonLogger.log(msg, payload)
  },
}

export const initFromEnv = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): ObservabilityHandle | undefined => {
  // Vitest sets NODE_ENV=test; skip initializing real Sentry/OTel
  // connections so test runs don't hang on open handles or ship telemetry.
  if (env['NODE_ENV'] === 'test') return undefined
  return isObservabilityConfigured(env)
    ? initObservability(env, { logger: observabilityLogger })
    : undefined
}

export const observability = initFromEnv()
