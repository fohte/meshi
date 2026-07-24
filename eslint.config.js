import { config } from '@fohte/eslint-config'

// Files that bridge to an external SDK's throw/reject-based contract (A2A
// SDK callbacks, Hono handlers, the MCP SDK, LangChain's tool()/callback
// APIs) or to process bootstrap that must fail fast (env loading, DB
// migrations/config, the composition root) — the only place throw/try-catch
// is allowed and the only place a neverthrow Result isn't expected.
const INTEROP_BOUNDARY_FILES = [
  'src/a2a/postgres-task-store.ts',
  'src/a2a/postgres-push-notification-store.ts',
  'src/a2a/agent-executor.ts',
  'src/a2a/hono-bridge.ts',
  'src/mcp-http.ts',
  'src/mcp-tools.ts',
  'src/app.ts',
  'src/llm/agent/tools.ts',
  'src/adapters/llm/genAiCallbackHandler.ts',
  'src/env.ts',
  'src/main.ts',
  'src/db/migrate.ts',
  'drizzle.config.ts',
  'scripts/seed.ts',
  // Not an interop boundary, but @fohte/eslint-config's built-in test
  // exemption only matches `*.test.ts`/`__tests__/**`, narrower than the
  // test helpers here that also use throw/try-catch.
  'src/test/db.ts',
  'src/test/global-setup.ts',
]

export default config(
  {
    typescript: { typeChecked: true },
    errorHandling: { interopBoundaryFiles: INTEROP_BOUNDARY_FILES },
  },
  { ignores: ['dist'] },
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['./*', '../*'],
              message:
                'Please use absolute imports instead of relative imports.',
            },
          ],
        },
      ],
    },
  },
)
