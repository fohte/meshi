import { describe, expect, it } from 'vitest'

import { normalizeResult } from '@/llm/domain-tools/test-helpers'
import { err, ok } from '@/llm/domain-tools/types'

describe('normalizeResult', () => {
  it('passes through ok results unchanged', () => {
    expect(normalizeResult(ok({ a: 1, b: 'x' }))).toEqual({
      ok: true,
      value: { a: 1, b: 'x' },
    })
  })

  it('masks the message and drops details when absent', () => {
    expect(
      normalizeResult(err({ code: 'something/failed', message: 'boom' })),
    ).toEqual({
      ok: false,
      error: { code: 'something/failed', message: '<dynamic>' },
    })
  })

  it('replaces an issues array with its count and keeps other details', () => {
    expect(
      normalizeResult(
        err({
          code: 'invalid_input',
          message: 'three issues',
          details: {
            issues: ['a', 'b', 'c'],
            status: 422,
          },
        }),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 3 }, status: 422 },
      },
    })
  })

  it('keeps non-issues details untouched', () => {
    expect(
      normalizeResult(
        err({
          code: 'web_search/failed',
          message: 'upstream',
          details: { status: 500 },
        }),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: 'web_search/failed',
        message: '<dynamic>',
        details: { status: 500 },
      },
    })
  })
})
