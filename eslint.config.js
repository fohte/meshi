import { config } from '@fohte/eslint-config'
import neverthrow from '@ninoseki/eslint-plugin-neverthrow'

// Files that bridge to an external SDK's throw/reject-based contract (A2A
// SDK callbacks, Hono handlers, the MCP SDK, LangChain's tool()/callback
// APIs) or to process bootstrap that must fail fast (env loading, DB
// migrations/seeding, the composition root) — the only place throw/
// try-catch is allowed and the only place a neverthrow Result isn't
// expected. Referenced by both overrides below so the two rules can't
// silently fall out of sync.
const INTEROP_BOUNDARY_FILES = [
  'src/a2a/**/*.ts',
  'src/mcp-http.ts',
  'src/mcp-tools.ts',
  'src/app.ts',
  'src/llm/agent/tools.ts',
  'src/adapters/llm/genAiCallbackHandler.ts',
  'src/env.ts',
  'src/main.ts',
  'src/db/**/*.ts',
]

export default config(
  { typescript: { typeChecked: true } },
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
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ThrowStatement',
          message:
            "Don't throw — return a Result via err()/errAsync(), or use ResultAsync.fromPromise() to interop with a throwing API without a local throw. Only the interop layer (files listed in the override below) may throw, to satisfy an external SDK's throw-based contract.",
        },
        {
          selector: 'TryStatement',
          message:
            "Don't use try/catch — use ResultAsync.fromPromise()/.andThen()/.mapErr()/.match() to turn a failure into a Result value. Only the interop layer (files listed in the override below) may use try/catch, to satisfy an external SDK's throw-based contract.",
        },
      ],
    },
  },
  {
    // allowThrowIn ledger: meshi-local prototype of an option planned for
    // @fohte/eslint-config. See INTEROP_BOUNDARY_FILES above for what
    // qualifies as this boundary.
    files: INTEROP_BOUNDARY_FILES,
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['**/*.test.ts', 'src/test/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // Same scope as the no-restricted-syntax rule above: Result/ResultAsync
    // is only expected to appear outside the interop layer and test files.
    files: ['src/**/*.ts'],
    ignores: ['**/*.test.ts', 'src/test/**/*.ts', ...INTEROP_BOUNDARY_FILES],
    plugins: { neverthrow },
    rules: {
      'neverthrow/must-use-result': 'error',
    },
  },
)
