import { defineConfig } from 'tsup'

export default defineConfig({
  // infra runs dist/db/migrate.js as an init container's entrypoint; see
  // src/db/migrate.ts.
  entry: ['src/index.ts', 'src/db/migrate.ts'],
  format: ['esm'],
  // Keep in sync with the node version in .mise.toml.
  target: 'node24',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  // Bundle first-party code; keep node_modules external so
  // @opentelemetry/auto-instrumentations-node's module-patching hook still
  // applies to the real package in node_modules instead of a bundled copy.
  skipNodeModulesBundle: true,
  // skipNodeModulesBundle's externalization check only recognizes relative
  // and absolute specifiers as first-party (see tsup's NON_NODE_MODULE_RE);
  // it can't tell a `#foo` subpath import (package.json #imports, resolved
  // by Node itself) apart from a bare package name, so without this it
  // externalizes `#foo` imports too and they're left unresolved in the
  // output — there's no node_modules/#foo to resolve them against at
  // runtime.
  noExternal: [/^#/],
})
