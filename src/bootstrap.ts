// Must run before any instrumented module is imported, otherwise
// @opentelemetry/auto-instrumentations-node cannot patch them — hence
// `import './bootstrap'` as the very first statement of `index.ts`.
// This alone is not enough for built-in modules like `http`, though: this
// process runs as ESM, and Node's ESM loader bypasses `require()`, which is
// what `@opentelemetry/instrumentation`'s patching normally hooks into.
// `otel-register.mjs` (registered via `--import` in the `start`/`dev` scripts
// and the Dockerfile's `CMD`) installs the loader hook that makes ESM
// `import`s patchable too — without it, `http.Server` is never patched and
// no server-side spans are created, no matter how early this file runs.
// https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md
import {
  initObservability,
  isObservabilityConfigured,
  type ObservabilityHandle,
} from '@fohte/service-kit/observability'

import { createJsonStdoutLogger } from '@/logger'

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
