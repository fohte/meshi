import { defineConfig, mergeConfig } from 'vitest/config'

// The "#*" subpath import mapping (package.json "imports") only covers
// src/, not sibling config files at the package root.
import viteConfig from './vite.config'

// vitest.config.ts fully replaces vite.config.ts rather than extending it
// (Vitest only reads one or the other), so the "#" alias and react plugin
// have to be pulled in explicitly via mergeConfig.
export default mergeConfig(viteConfig, defineConfig({}))
