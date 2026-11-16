import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { SettingsPage } from '#pages/SettingsPage'
import { performAct, setInputValue } from '#test/test-helpers'

interface RequestRecord {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const goalWeightPatchSchema = z.object({
  goalWeightKg: z.number().nullable().optional(),
})

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 40 && !condition(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SettingsPage', () => {
  it('saves and clears the goal weight through profile patches', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const requests: Array<RequestRecord> = []
    let goalWeightKg: number | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        const method = init?.method ?? 'GET'
        const body: unknown =
          typeof init?.body === 'string' ? JSON.parse(init.body) : null

        if (path === '/api/profile' && method === 'PATCH') {
          requests.push({ method, path, body })
          const parsed = goalWeightPatchSchema.safeParse(body)
          if (!parsed.success) {
            return Promise.resolve(
              jsonResponse({ error: 'invalid patch' }, 400),
            )
          }
          if (parsed.data.goalWeightKg !== undefined) {
            goalWeightKg = parsed.data.goalWeightKg
          }
        }

        if (path === '/api/profile') {
          return Promise.resolve(
            jsonResponse({
              likes: [],
              dislikes: [],
              allergies: [],
              constraints: [],
              dailyTargets: null,
              goalWeightKg,
            }),
          )
        }
        if (path === '/api/nutrient-definitions') {
          return Promise.resolve(jsonResponse([]))
        }
        return Promise.resolve(
          jsonResponse({ error: 'unexpected request' }, 500),
        )
      }),
    )

    const container = document.createElement('div')
    document.body.append(container)
    const root: Root = createRoot(container)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    })

    try {
      await performAct(() => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <SettingsPage />
          </QueryClientProvider>,
        )
      })
      await waitFor(() => container.querySelector('#goal-weight-kg') !== null)

      const input = container.querySelector<HTMLInputElement>('#goal-weight-kg')
      if (input !== null) await setInputValue(input, '64.25')
      await performAct(() => {
        container.querySelector<HTMLFormElement>('form')?.requestSubmit()
      })
      await waitFor(
        () =>
          requests.length === 1 &&
          container.querySelector<HTMLInputElement>('#goal-weight-kg')
            ?.value === '64.25',
      )
      await waitFor(() => {
        const button = Array.from(
          container.querySelectorAll<HTMLButtonElement>('button'),
        ).find((element) => element.textContent === '削除')
        return button !== undefined && !button.disabled
      })

      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === '削除')
          ?.click()
      })
      await waitFor(
        () =>
          requests.length === 2 &&
          container.querySelector<HTMLInputElement>('#goal-weight-kg')
            ?.value === '',
      )

      expect(requests).toEqual([
        {
          method: 'PATCH',
          path: '/api/profile',
          body: { goalWeightKg: 64.25 },
        },
        {
          method: 'PATCH',
          path: '/api/profile',
          body: { goalWeightKg: null },
        },
      ])
    } finally {
      await performAct(() => {
        root.unmount()
      })
      queryClient.clear()
      container.remove()
    }
  })
})
