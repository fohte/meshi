import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HistoryCalendarView } from '#pages/history/HistoryCalendarView'
import { performAct } from '#test/test-helpers'

interface RequestRecord {
  readonly method: string
  readonly path: string
}

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 40 && !condition(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

const calendarOutput = (
  requests: ReadonlyArray<RequestRecord>,
  container: HTMLElement,
) => {
  const past = container.querySelector('a[href="/days/2026-07-04"]')
  const today = container.querySelector('a[href="/days/2026-07-05"]')
  const future = container.querySelector('a[href="/days/2026-07-06"]')
  return {
    mealPlanRequests: requests.filter((request) =>
      request.path.startsWith('/api/meal-plans?'),
    ),
    past: {
      href: past?.getAttribute('href') ?? null,
      text: past?.textContent ?? null,
    },
    today: {
      href: today?.getAttribute('href') ?? null,
      text: today?.textContent ?? null,
    },
    future: {
      href: future?.getAttribute('href') ?? null,
      text: future?.textContent ?? null,
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('HistoryCalendarView', () => {
  it('loads one month of meal plans and links future days with planned counts', async () => {
    const requests: RequestRecord[] = []
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        requests.push({ method: 'GET', path })

        if (path.startsWith('/api/meal-history?')) {
          return Promise.resolve(
            jsonResponse({
              totals: {},
              perDay: [],
              entries: [],
              hasEstimatedValues: false,
              hasUnknownValues: false,
            }),
          )
        }
        if (path.startsWith('/api/meal-plans?')) {
          return Promise.resolve(
            jsonResponse([
              ...[
                ['plan_past', '2026-07-04', 'planned'],
                ['plan_today', '2026-07-05', 'planned'],
                ['plan_future_a', '2026-07-06', 'planned'],
                ['plan_future_b', '2026-07-06', 'planned'],
                ['plan_cancelled', '2026-07-06', 'cancelled'],
                ['plan_eaten', '2026-07-06', 'eaten'],
              ].map(([id, date, status]) => ({
                id,
                date,
                status,
                mealType: 'breakfast',
                reason: null,
                items: [],
              })),
            ]),
          )
        }
        return Promise.resolve(jsonResponse({ error: 'unexpected request' }))
      }),
    )

    const container = document.createElement('div')
    document.body.append(container)
    const root: Root = createRoot(container)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    try {
      await performAct(() => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <MemoryRouter>
              <HistoryCalendarView targets={null} />
            </MemoryRouter>
          </QueryClientProvider>,
        )
      })
      await waitFor(() =>
        Boolean(container.querySelector('a[href="/days/2026-07-06"]')),
      )

      expect(calendarOutput(requests, container)).toEqual({
        mealPlanRequests: [
          {
            method: 'GET',
            path: '/api/meal-plans?from=2026-07-01&to=2026-08-01',
          },
        ],
        past: { href: '/days/2026-07-04', text: '4' },
        today: { href: '/days/2026-07-05', text: '5' },
        future: { href: '/days/2026-07-06', text: '6予定 2' },
      })
    } finally {
      await performAct(() => {
        root.unmount()
      })
      queryClient.clear()
      container.remove()
    }
  })
})
