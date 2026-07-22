// Node's ESM loader bypasses `require()`, so `@opentelemetry/instrumentation`'s
// module-patching (used by instrumentation-http and friends to create spans
// for built-in modules like `http`) never runs against `import`ed modules
// unless this loader hook is registered before the app itself loads — without
// it, `http.Server` is never patched and no server-side spans are created.
// https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('@opentelemetry/instrumentation/hook.mjs', pathToFileURL('./'))
