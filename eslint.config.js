import { config } from '@fohte/eslint-config'
import neverthrow from '@ninoseki/eslint-plugin-neverthrow'

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
    // @fohte/eslint-config. Every file here sits at a boundary this
    // migration can't put a Result across:
    //   - SDK interop, where an external library's own contract is
    //     throw/reject- or synchronous-void-based (the A2A SDK's
    //     TaskStore/AgentExecutor/event-bus callbacks, Hono route handlers,
    //     the MCP SDK's CallToolResult shape, LangChain's tool() wrapper and
    //     BaseCallbackHandler methods)
    //   - process bootstrap, where throwing to fail fast (env/config
    //     loading, DB migrations, one-off seed scripts, the composition
    //     root that wires everything together) is the correct behavior,
    //     not error-swallowing — main()'s own top-level catch already
    //     reports these to Sentry before exiting
    // Everywhere else, failure must be a neverthrow Result/ResultAsync value.
    files: [
      'src/a2a/**/*.ts',
      'src/mcp-http.ts',
      'src/mcp-tools.ts',
      'src/app.ts',
      'src/llm/agent/tools.ts',
      'src/adapters/llm/genAiCallbackHandler.ts',
      'src/env.ts',
      'src/main.ts',
      'src/db/**/*.ts',
    ],
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
    ignores: [
      '**/*.test.ts',
      'src/test/**/*.ts',
      'src/a2a/**/*.ts',
      'src/mcp-http.ts',
      'src/mcp-tools.ts',
      'src/app.ts',
      'src/llm/agent/tools.ts',
      'src/adapters/llm/genAiCallbackHandler.ts',
      'src/env.ts',
      'src/main.ts',
      'src/db/**/*.ts',
    ],
    plugins: { neverthrow },
    rules: {
      'neverthrow/must-use-result': 'error',
    },
  },
)
