import { describe, expect, it } from 'vitest'

import { resolveWebDistRoot } from '#web-dist-root'

describe('resolveWebDistRoot', () => {
  it('uses web assets beside the deployed package root', () => {
    const root = resolveWebDistRoot(
      '/app',
      (candidate) => candidate === '/app/web/dist',
    )
    expect(root).toBe('/app/web/dist')
  })

  it('uses the web workspace build beside the server package', () => {
    const root = resolveWebDistRoot(
      '/workspace/server',
      (candidate) => candidate === '/workspace/web/dist',
    )
    expect(root).toBe('/workspace/web/dist')
  })
})
