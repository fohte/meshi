import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MealLogSheetContext } from '#meal-log-sheet/MealLogSheetContext'
import { MealLogSheetProvider } from '#meal-log-sheet/MealLogSheetProvider'

interface RequestRecord {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

const MEAL_SET = {
  id: 'ms_demo_alpha',
  name: '作業用セット',
  items: [
    {
      foodMasterId: 'fm_demo_alpha',
      foodName: '架空食品 A',
      quantity: 1,
      energyKcalPerUnit: 120,
    },
    {
      foodMasterId: 'fm_demo_beta',
      foodName: '架空食品 B',
      quantity: 0.75,
      energyKcalPerUnit: 80,
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
}

const MEAL_LOG_RESULT = {
  id: 'ml_demo_alpha',
  foodMasterId: 'fm_demo_alpha',
  eatenDate: '2026-01-02',
  mealType: 'dinner',
  quantity: 2.5,
  nutrition: {},
  isEstimated: false,
  nutritionStatus: 'unknown',
  createdAt: '2026-01-02T12:00:00.000Z',
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const performAct = (callback: () => void): Promise<void> =>
  act(async () => {
    callback()
    await Promise.resolve()
  })

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 40 && !condition(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  if (!condition()) throw new Error('condition was not met')
}

const clickButton = async (
  container: HTMLElement,
  label: string,
): Promise<void> => {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button'),
  ).find(
    (candidate) =>
      candidate.textContent.includes(label) ||
      candidate.getAttribute('aria-label')?.includes(label) === true,
  )
  if (button === undefined) throw new Error(`button not found: ${label}`)
  await performAct(() => {
    button.click()
  })
}

const setInputValue = async (
  input: HTMLInputElement,
  value: string,
): Promise<void> =>
  performAct(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.bind(input)
    if (setter !== undefined) setter(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

const setupSheet = (
  submitResponse: Response,
): {
  readonly container: HTMLDivElement
  readonly root: Root
  readonly queryClient: QueryClient
  readonly requests: Array<RequestRecord>
} => {
  const requests: Array<RequestRecord> = []
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
      requests.push({ method, path, body })

      return Promise.resolve(
        path.startsWith('/api/foods/suggestions?')
          ? jsonResponse({ recent: [], frequent: [] })
          : path === '/api/meal-sets'
            ? jsonResponse([MEAL_SET])
            : path === '/api/meal-logs' && method === 'POST'
              ? submitResponse
              : jsonResponse({}, 404),
      )
    }),
  )

  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })

  return { container, root, queryClient, requests }
}

const renderSheet = async (
  root: Root,
  queryClient: QueryClient,
): Promise<void> => {
  await performAct(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MealLogSheetProvider>
          <MealLogSheetContext.Consumer>
            {({ openCreate }) => (
              <button type="button" onClick={openCreate}>
                記録を開く
              </button>
            )}
          </MealLogSheetContext.Consumer>
        </MealLogSheetProvider>
      </QueryClientProvider>,
    )
  })
}

const startMealSetRecording = async (
  container: HTMLElement,
  requests: ReadonlyArray<RequestRecord>,
): Promise<void> => {
  await clickButton(container, '記録を開く')
  await clickButton(container, 'マイセット')
  await waitFor(() => requests.some(({ path }) => path === '/api/meal-sets'))
  await waitFor(() =>
    Array.from(container.querySelectorAll('button')).some((button) =>
      button.textContent.includes(MEAL_SET.name),
    ),
  )
  await clickButton(container, MEAL_SET.name)
}

const cleanupSheet = async (
  container: HTMLElement,
  root: Root,
  queryClient: QueryClient,
): Promise<void> => {
  await performAct(() => {
    root.unmount()
  })
  queryClient.clear()
  container.remove()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MealLogSheetProvider meal set recording', () => {
  it('posts edited set items together with the chosen meal type and date', async () => {
    const setup = setupSheet(jsonResponse([MEAL_LOG_RESULT], 201))
    await renderSheet(setup.root, setup.queryClient)

    try {
      await startMealSetRecording(setup.container, setup.requests)

      const quantityInput = setup.container.querySelector<HTMLInputElement>(
        'input[aria-label="架空食品 A の量"]',
      )
      if (quantityInput !== null) {
        await setInputValue(quantityInput, '2.5')
      }
      const dateInput =
        setup.container.querySelector<HTMLInputElement>('input[type="date"]')
      if (dateInput !== null) await setInputValue(dateInput, '2026-01-02')
      await clickButton(setup.container, '夕食')
      await clickButton(setup.container, 'まとめて記録')
      await waitFor(() =>
        setup.requests.some(
          ({ path, method }) => path === '/api/meal-logs' && method === 'POST',
        ),
      )

      expect(setup.requests).toEqual([
        {
          method: 'GET',
          path: '/api/foods/suggestions?limit=5',
          body: null,
        },
        { method: 'GET', path: '/api/meal-sets', body: null },
        {
          method: 'POST',
          path: '/api/meal-logs',
          body: {
            eatenDate: '2026-01-02',
            mealType: 'dinner',
            items: [
              { foodMasterId: 'fm_demo_alpha', quantity: 2.5 },
              { foodMasterId: 'fm_demo_beta', quantity: 0.75 },
            ],
          },
        },
      ])
    } finally {
      await cleanupSheet(setup.container, setup.root, setup.queryClient)
    }
  })

  it('shows the food name for a rejected batch item', async () => {
    const setup = setupSheet(
      jsonResponse({ error: 'invalid quantity', itemIndex: 2 }, 400),
    )
    await renderSheet(setup.root, setup.queryClient)

    try {
      await startMealSetRecording(setup.container, setup.requests)
      const dateInput =
        setup.container.querySelector<HTMLInputElement>('input[type="date"]')
      if (dateInput !== null) await setInputValue(dateInput, '2026-01-02')
      await clickButton(setup.container, '夕食')
      await clickButton(setup.container, 'まとめて記録')
      await waitFor(
        () => setup.container.querySelector('[role="alert"]') !== null,
      )
      await clickButton(setup.container, '架空食品 A を削除')
      await waitFor(
        () =>
          setup.container.querySelector(
            'input[aria-label="架空食品 B の量"]',
          ) !== null,
      )

      const output = () => ({
        requests: setup.requests,
        error: setup.container.querySelector('[role="alert"]')?.textContent,
        remainingItems: Array.from(
          setup.container.querySelectorAll<HTMLInputElement>(
            'input[aria-label$=" の量"]',
          ),
          (input) => input.getAttribute('aria-label'),
        ),
      })

      expect(output()).toEqual({
        requests: [
          {
            method: 'GET',
            path: '/api/foods/suggestions?limit=5',
            body: null,
          },
          { method: 'GET', path: '/api/meal-sets', body: null },
          {
            method: 'POST',
            path: '/api/meal-logs',
            body: {
              eatenDate: '2026-01-02',
              mealType: 'dinner',
              items: [
                { foodMasterId: 'fm_demo_alpha', quantity: 1 },
                { foodMasterId: 'fm_demo_beta', quantity: 0.75 },
              ],
            },
          },
        ],
        error: '「架空食品 B」の記録に失敗しました: invalid quantity',
        remainingItems: ['架空食品 B の量'],
      })
    } finally {
      await cleanupSheet(setup.container, setup.root, setup.queryClient)
    }
  })
})
