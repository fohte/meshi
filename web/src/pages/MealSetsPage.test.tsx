import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { MealSetsPage } from '#pages/MealSetsPage'

interface RequestRecord {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

interface MealSetRecord {
  readonly id: string
  readonly name: string
  readonly items: ReadonlyArray<{
    readonly foodMasterId: string
    readonly foodName: string
    readonly quantity: number
    readonly energyKcalPerUnit: number | null
  }>
  readonly createdAt: string
}

const saveMealSetInputSchema = z.object({
  name: z.string(),
  items: z.array(
    z.object({
      foodMasterId: z.string(),
      quantity: z.number(),
    }),
  ),
})

const food = {
  foodMasterId: 'food_demo_alpha',
  compositionCode: null,
  name: '架空食品 A',
  isEstimated: false,
  nutritionStatus: 'estimated',
  reason: 'fuzzy_name',
  source: 'user_input',
  energyKcalPerUnit: 120,
}
const foodSearchPath = `/api/foods/search?${new URLSearchParams({ q: '架空食品', limit: '20' }).toString()}`

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 40 && !condition(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

const readMealSets = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('article')).map((article) => ({
    name: article.querySelector('h2')?.textContent,
    energy: article.querySelector('p')?.textContent,
    items: Array.from(article.querySelectorAll('li')).map((item) =>
      item.textContent.trim(),
    ),
  }))

const readPageState = (container: HTMLElement) => ({
  paragraphs: Array.from(container.querySelectorAll('p')).map((paragraph) =>
    paragraph.textContent.trim(),
  ),
  mealSets: readMealSets(container),
  editorOpen: container.querySelector('#meal-set-editor-title') !== null,
})

const readPageOutput = (
  requests: ReadonlyArray<RequestRecord>,
  container: HTMLElement,
) => ({ requests, page: readPageState(container) })

const readEditorErrorOutput = (
  container: HTMLElement,
  requests: ReadonlyArray<RequestRecord>,
) => ({
  requests,
  output: {
    error: container.querySelector('[role="alert"]')?.textContent,
    editorTitle: container.querySelector('#meal-set-editor-title')?.textContent,
  },
})

const performAct = (callback: () => void): Promise<void> =>
  act(async () => {
    callback()
    await Promise.resolve()
  })

const renderPage = (root: Root, queryClient: QueryClient): void => {
  root.render(
    <QueryClientProvider client={queryClient}>
      <MealSetsPage />
    </QueryClientProvider>,
  )
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

const clickButton = async (
  container: HTMLElement,
  selector: string,
): Promise<void> => {
  const button = container.querySelector<HTMLButtonElement>(selector)
  await performAct(() => {
    button?.click()
  })
}

const selectRecentFood = async (container: HTMLElement): Promise<void> => {
  await clickButton(container, 'button[aria-label="新しいマイセットを作成"]')
  await waitFor(
    () =>
      container.querySelector('button[aria-label="食品を追加 架空食品 A"]') !==
      null,
  )
  await clickButton(container, 'button[aria-label="食品を追加 架空食品 A"]')
}

const selectSearchedFood = async (
  container: HTMLElement,
  requests: ReadonlyArray<RequestRecord>,
): Promise<void> => {
  await clickButton(container, 'button[aria-label="新しいマイセットを作成"]')
  const searchInput = container.querySelector<HTMLInputElement>(
    '#meal-set-food-search',
  )
  if (searchInput !== null) await setInputValue(searchInput, '架空食品')
  await waitFor(() =>
    requests.some(({ path }) => path.startsWith('/api/foods/search?')),
  )
  await waitFor(
    () =>
      container.querySelector('button[aria-label="食品を追加 架空食品 A"]') !==
      null,
  )
  await clickButton(container, 'button[aria-label="食品を追加 架空食品 A"]')
}

const setMealSetName = async (
  container: HTMLElement,
  name: string,
): Promise<void> => {
  const nameInput = container.querySelector<HTMLInputElement>('#meal-set-name')
  if (nameInput !== null) await setInputValue(nameInput, name)
}

const savedMealSet = (quantity = 1): MealSetRecord => ({
  id: 'meal_set_demo_one',
  name: '作業用セット',
  items: [
    {
      foodMasterId: food.foodMasterId,
      foodName: food.name,
      quantity,
      energyKcalPerUnit: food.energyKcalPerUnit,
    },
  ],
  createdAt: '2040-01-02T00:00:00.000Z',
})

const setupPage = (
  fetchHandler: (path: string, method: string, body: unknown) => Response,
  requests: Array<RequestRecord>,
): {
  readonly container: HTMLDivElement
  readonly root: Root
  readonly queryClient: QueryClient
} => {
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
      return Promise.resolve(fetchHandler(path, method, body))
    }),
  )

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  return { container, root, queryClient }
}

const cleanupPage = async (
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

describe('MealSetsPage', () => {
  it('creates a meal set from searched food', async () => {
    const requests: Array<RequestRecord> = []
    const mealSets: Array<MealSetRecord> = []
    const { container, root, queryClient } = setupPage((path, method, body) => {
      if (path === '/api/meal-sets' && method === 'GET') {
        return jsonResponse(mealSets)
      }
      if (path === '/api/foods/suggestions?limit=5') {
        return jsonResponse({ recent: [food], frequent: [] })
      }
      if (path === foodSearchPath) {
        return jsonResponse({ items: [food] })
      }
      if (path === '/api/meal-sets' && method === 'POST') {
        const parsedInput = saveMealSetInputSchema.safeParse(body)
        if (!parsedInput.success) {
          return jsonResponse({ error: 'invalid request' }, 500)
        }
        const input = parsedInput.data
        const created: MealSetRecord = {
          id: 'meal_set_demo_one',
          name: input.name,
          items: input.items.map((item) => ({
            ...item,
            foodName: food.name,
            energyKcalPerUnit: food.energyKcalPerUnit,
          })),
          createdAt: '2040-01-02T00:00:00.000Z',
        }
        mealSets.push(created)
        return jsonResponse(created, 201)
      }
      return jsonResponse({ error: 'unexpected request' }, 500)
    }, requests)

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await waitFor(() => container.textContent.includes('新しいマイセット'))
      await selectSearchedFood(container, requests)
      await setMealSetName(container, '作業用セット')
      await clickButton(container, 'button[type="submit"]')
      await waitFor(
        () =>
          container.querySelector('button[aria-label="編集 作業用セット"]') !==
          null,
      )

      expect(readPageOutput(requests, container)).toEqual({
        requests: [
          { method: 'GET', path: '/api/meal-sets', body: null },
          {
            method: 'GET',
            path: '/api/foods/suggestions?limit=5',
            body: null,
          },
          {
            method: 'GET',
            path: foodSearchPath,
            body: null,
          },
          {
            method: 'POST',
            path: '/api/meal-sets',
            body: {
              name: '作業用セット',
              items: [{ foodMasterId: food.foodMasterId, quantity: 1 }],
            },
          },
          { method: 'GET', path: '/api/meal-sets', body: null },
        ],
        page: {
          paragraphs: [
            'よく食べる食品の組み合わせと量を登録できます。',
            '約 120 kcal',
          ],
          mealSets: [
            {
              name: '作業用セット',
              energy: '約 120 kcal',
              items: ['架空食品 A1 ×'],
            },
          ],
          editorOpen: false,
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('updates a meal set quantity and recalculates its energy', async () => {
    const requests: Array<RequestRecord> = []
    const mealSets: Array<MealSetRecord> = [savedMealSet()]
    const { container, root, queryClient } = setupPage((path, method, body) => {
      if (path === '/api/meal-sets' && method === 'GET') {
        return jsonResponse(mealSets)
      }
      if (path === '/api/foods/suggestions?limit=5') {
        return jsonResponse({ recent: [food], frequent: [] })
      }
      if (path === '/api/meal-sets/meal_set_demo_one' && method === 'PATCH') {
        const parsedInput = saveMealSetInputSchema.safeParse(body)
        if (!parsedInput.success) {
          return jsonResponse({ error: 'invalid request' }, 500)
        }
        const current = mealSets[0]
        if (current === undefined) {
          return jsonResponse({ error: 'meal set not found' }, 404)
        }
        const input = parsedInput.data
        const updated: MealSetRecord = {
          ...current,
          name: input.name,
          items: input.items.map((item) => ({
            ...item,
            foodName: food.name,
            energyKcalPerUnit: food.energyKcalPerUnit,
          })),
        }
        mealSets[0] = updated
        return jsonResponse(updated)
      }
      return jsonResponse({ error: 'unexpected request' }, 500)
    }, requests)

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await waitFor(
        () =>
          container.querySelector('button[aria-label="編集 作業用セット"]') !==
          null,
      )
      await clickButton(container, 'button[aria-label="編集 作業用セット"]')
      await waitFor(
        () =>
          container.querySelector<HTMLInputElement>(
            `input[aria-label="${food.name} の量"]`,
          ) !== null,
      )
      const quantityInput = container.querySelector<HTMLInputElement>(
        `input[aria-label="${food.name} の量"]`,
      )
      if (quantityInput !== null) await setInputValue(quantityInput, '2.5001')
      await clickButton(container, 'button[type="submit"]')
      await waitFor(() => container.textContent.includes('約 300 kcal'))

      expect(readPageOutput(requests, container)).toEqual({
        requests: [
          { method: 'GET', path: '/api/meal-sets', body: null },
          {
            method: 'GET',
            path: '/api/foods/suggestions?limit=5',
            body: null,
          },
          {
            method: 'PATCH',
            path: '/api/meal-sets/meal_set_demo_one',
            body: {
              name: '作業用セット',
              items: [{ foodMasterId: food.foodMasterId, quantity: 2.5001 }],
            },
          },
          { method: 'GET', path: '/api/meal-sets', body: null },
        ],
        page: {
          paragraphs: [
            'よく食べる食品の組み合わせと量を登録できます。',
            '約 300 kcal',
          ],
          mealSets: [
            {
              name: '作業用セット',
              energy: '約 300 kcal',
              items: ['架空食品 A2.5001 ×'],
            },
          ],
          editorOpen: false,
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('deletes a meal set after confirmation', async () => {
    const requests: Array<RequestRecord> = []
    const mealSets: Array<MealSetRecord> = [savedMealSet()]
    const { container, root, queryClient } = setupPage((path, method) => {
      if (path === '/api/meal-sets' && method === 'GET') {
        return jsonResponse(mealSets)
      }
      if (path === '/api/meal-sets/meal_set_demo_one' && method === 'DELETE') {
        mealSets.splice(0, 1)
        return new Response(null, { status: 204 })
      }
      return jsonResponse({ error: 'unexpected request' }, 500)
    }, requests)

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await waitFor(
        () =>
          container.querySelector('button[aria-label="削除 作業用セット"]') !==
          null,
      )
      await clickButton(container, 'button[aria-label="削除 作業用セット"]')
      await clickButton(
        container,
        'button[aria-label="削除を確定 作業用セット"]',
      )
      await waitFor(() =>
        container.textContent.includes('マイセットはまだありません。'),
      )

      expect(readPageOutput(requests, container)).toEqual({
        requests: [
          { method: 'GET', path: '/api/meal-sets', body: null },
          {
            method: 'DELETE',
            path: '/api/meal-sets/meal_set_demo_one',
            body: null,
          },
          { method: 'GET', path: '/api/meal-sets', body: null },
        ],
        page: {
          paragraphs: [
            'よく食べる食品の組み合わせと量を登録できます。',
            'マイセットはまだありません。',
            'よく食べる食品の組み合わせを登録できます。',
          ],
          mealSets: [],
          editorOpen: false,
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('rejects a quantity of zero before sending a request', async () => {
    const requests: Array<RequestRecord> = []
    const { container, root, queryClient } = setupPage((path, method) => {
      if (path === '/api/meal-sets' && method === 'GET') {
        return jsonResponse([])
      }
      if (path === '/api/foods/suggestions?limit=5') {
        return jsonResponse({ recent: [food], frequent: [] })
      }
      return jsonResponse({ error: 'unexpected request' }, 500)
    }, requests)

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await waitFor(() => container.textContent.includes('新しいマイセット'))
      await selectRecentFood(container)
      await setMealSetName(container, '作業用セット')
      const quantityInput = container.querySelector<HTMLInputElement>(
        `input[aria-label="${food.name} の量"]`,
      )
      if (quantityInput !== null) await setInputValue(quantityInput, '0')
      await clickButton(container, 'button[type="submit"]')
      await waitFor(
        () =>
          container
            .querySelector('[role="alert"]')
            ?.textContent.includes(
              '量は 0 より大きい数を入力してください。',
            ) === true,
      )

      expect(readEditorErrorOutput(container, requests)).toEqual({
        requests: [
          { method: 'GET', path: '/api/meal-sets', body: null },
          {
            method: 'GET',
            path: '/api/foods/suggestions?limit=5',
            body: null,
          },
        ],
        output: {
          error: '量は 0 より大きい数を入力してください。',
          editorTitle: '##新しいマイセット',
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('shows the API message when a meal set name is already used', async () => {
    const requests: Array<RequestRecord> = []
    const { container, root, queryClient } = setupPage((path, method) => {
      if (path === '/api/meal-sets' && method === 'GET') {
        return jsonResponse([])
      }
      if (path === '/api/foods/suggestions?limit=5') {
        return jsonResponse({ recent: [food], frequent: [] })
      }
      if (path === '/api/meal-sets' && method === 'POST') {
        return jsonResponse(
          { error: '同じ名前のマイセットがすでにあります。' },
          409,
        )
      }
      return jsonResponse({ error: 'unexpected request' }, 500)
    }, requests)

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await waitFor(() => container.textContent.includes('新しいマイセット'))
      await selectRecentFood(container)
      await setMealSetName(container, '作業用セット')
      await clickButton(container, 'button[type="submit"]')
      await waitFor(() => container.querySelector('[role="alert"]') !== null)

      expect(readEditorErrorOutput(container, requests)).toEqual({
        requests: [
          { method: 'GET', path: '/api/meal-sets', body: null },
          {
            method: 'GET',
            path: '/api/foods/suggestions?limit=5',
            body: null,
          },
          {
            method: 'POST',
            path: '/api/meal-sets',
            body: {
              name: '作業用セット',
              items: [{ foodMasterId: food.foodMasterId, quantity: 1 }],
            },
          },
        ],
        output: {
          error: '同じ名前のマイセットがすでにあります。',
          editorTitle: '##新しいマイセット',
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })
})
