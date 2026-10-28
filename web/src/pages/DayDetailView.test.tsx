import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { MealLogSheetProvider } from '#meal-log-sheet/MealLogSheetProvider'
import { DayDetailView } from '#pages/DayDetailView'
import { performAct, setInputValue } from '#test/test-helpers'

interface RequestRecord {
  readonly method: string
  readonly path: string
  readonly body: unknown
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

const foodNameById: Readonly<Record<string, string>> = {
  food_fixture_001: 'テスト食品_001',
  food_fixture_002: 'テスト食品_002',
}

const dayDetail = {
  date: '2093-04-12',
  totals: {},
  incompleteNutrients: [],
  hasEstimatedValues: false,
  hasUnknownValues: false,
  entries: [
    {
      id: 'entry_fixture_001',
      foodMasterId: 'food_fixture_001',
      foodName: 'テスト食品_001',
      eatenDate: '2093-04-12',
      mealType: 'breakfast',
      quantity: 1.25,
      kcal: 100,
      isEstimated: false,
      nutritionStatus: 'confirmed',
      nutritionVersion: {
        versionNo: 32,
        changeKind: 'initial',
        source: 'web_search',
        isEstimated: false,
        checkedOn: '2093-04-02',
        effectiveFrom: '2093-04-01',
      },
      nutritionVersionOrigin: 'recorded',
      nutritionVersionDifferences: [],
    },
    {
      id: 'entry_fixture_002',
      foodMasterId: 'food_fixture_002',
      foodName: 'テスト食品_002',
      eatenDate: '2093-04-12',
      mealType: 'breakfast',
      quantity: 0.5,
      kcal: 80,
      isEstimated: false,
      nutritionStatus: 'confirmed',
      nutritionVersion: {
        versionNo: 33,
        changeKind: 'initial',
        source: 'web_search',
        isEstimated: false,
        checkedOn: '2093-04-03',
        effectiveFrom: '2093-04-02',
      },
      nutritionVersionOrigin: 'recorded',
      nutritionVersionDifferences: [],
    },
    {
      id: 'entry_fixture_003',
      foodMasterId: 'food_fixture_001',
      foodName: 'テスト食品_001',
      eatenDate: '2093-04-12',
      mealType: 'breakfast',
      quantity: 2,
      kcal: 160,
      isEstimated: false,
      nutritionStatus: 'confirmed',
      nutritionVersion: {
        versionNo: 32,
        changeKind: 'initial',
        source: 'web_search',
        isEstimated: false,
        checkedOn: '2093-04-02',
        effectiveFrom: '2093-04-01',
      },
      nutritionVersionOrigin: 'recorded',
      nutritionVersionDifferences: [],
    },
    {
      id: 'entry_fixture_004',
      foodMasterId: 'food_fixture_lunch',
      foodName: 'テスト食品_昼食',
      eatenDate: '2093-04-12',
      mealType: 'lunch',
      quantity: 3,
      kcal: 90,
      isEstimated: false,
      nutritionStatus: 'confirmed',
      nutritionVersion: {
        versionNo: 34,
        changeKind: 'initial',
        source: 'web_search',
        isEstimated: false,
        checkedOn: '2093-04-04',
        effectiveFrom: '2093-04-03',
      },
      nutritionVersionOrigin: 'recorded',
      nutritionVersionDifferences: [],
    },
  ],
  skippedMealTypes: [],
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const mealSetPosts = (
  requests: ReadonlyArray<RequestRecord>,
): ReadonlyArray<RequestRecord> =>
  requests.filter(
    (request) => request.method === 'POST' && request.path === '/api/meal-sets',
  )

const expectedMealSetPost = (name: string): RequestRecord => ({
  method: 'POST',
  path: '/api/meal-sets',
  body: {
    name,
    items: [
      { foodMasterId: 'food_fixture_001', quantity: 3.25 },
      { foodMasterId: 'food_fixture_002', quantity: 0.5 },
    ],
  },
})

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 40 && !condition(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

const setupPage = (
  saveResponse: (body: unknown) => Response | Promise<Response>,
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

      if (method === 'POST' && path === '/api/meal-sets') {
        return Promise.resolve(saveResponse(body))
      }
      if (path === '/api/days/2093-04-12') {
        return Promise.resolve(jsonResponse(dayDetail))
      }
      if (path === '/api/nutrient-definitions') {
        return Promise.resolve(jsonResponse([]))
      }
      if (path === '/api/profile') {
        return Promise.resolve(
          jsonResponse({
            likes: [],
            dislikes: [],
            allergies: [],
            constraints: [],
            dailyTargets: { energy_kcal: 1900 },
          }),
        )
      }
      if (path.startsWith('/api/meal-photos/')) {
        return Promise.resolve(jsonResponse([]))
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected request' }, 500))
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

const renderPage = (root: Root, queryClient: QueryClient): void => {
  root.render(
    <QueryClientProvider client={queryClient}>
      <MealLogSheetProvider>
        <MemoryRouter>
          <DayDetailView date="2093-04-12" />
        </MemoryRouter>
      </MealLogSheetProvider>
    </QueryClientProvider>,
  )
}

const submitMealSet = async (
  container: HTMLElement,
  name: string,
): Promise<void> => {
  const saveButton = container.querySelector<HTMLButtonElement>(
    'button[aria-label="朝食をマイセットとして保存"]',
  )
  await performAct(() => {
    saveButton?.click()
  })

  const nameInput = container.querySelector<HTMLInputElement>(
    '#meal-set-save-breakfast-name',
  )
  if (nameInput !== null) await setInputValue(nameInput, name)
  await performAct(() => {
    container
      .querySelector<HTMLFormElement>('#meal-set-save-breakfast form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

const saveOutput = (
  requests: ReadonlyArray<RequestRecord>,
  container: HTMLElement,
  submitButton?: HTMLButtonElement | null,
) => ({
  requests: mealSetPosts(requests),
  output: {
    error: container.querySelector('[role="alert"]')?.textContent ?? null,
    status: container.querySelector('[role="status"]')?.textContent ?? null,
    formOpen: container.querySelector('#meal-set-save-breakfast') !== null,
    ...(submitButton === undefined
      ? {}
      : { submitDisabled: submitButton?.disabled ?? null }),
  },
})

const nutritionBasisOutput = (container: HTMLElement) => {
  const basis = container.querySelector(
    'section[aria-labelledby="nutrition-basis-title"]',
  )
  return {
    title: basis?.querySelector('h3')?.textContent ?? null,
    rows:
      basis === null
        ? null
        : Array.from(basis.querySelectorAll('dt, dd')).map(
            (element) => element.textContent,
          ),
  }
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

describe('DayDetailView', () => {
  it('shows the nutrition basis for a meal log opened from the day view', async () => {
    const requests: Array<RequestRecord> = []
    const { container, root, queryClient } = setupPage(
      () => jsonResponse({}),
      requests,
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await waitFor(() =>
        Array.from(container.querySelectorAll('button')).some((button) =>
          button.textContent.includes('テスト食品_001'),
        ),
      )
      const mealLogButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent.includes('テスト食品_001'))
      if (mealLogButton === undefined) {
        throw new Error('day detail entry button was not rendered')
      }
      await performAct(() => {
        mealLogButton.click()
      })
      await waitFor(
        () =>
          container.querySelector(
            'section[aria-labelledby="nutrition-basis-title"]',
          ) !== null,
      )

      expect(nutritionBasisOutput(container)).toEqual({
        title: '栄養の根拠',
        rows: [
          'バージョン',
          'v32 · 初回登録',
          '値の出所',
          'Web検索 (推定値ではない)',
          '確認日',
          '2093-04-02',
          '適用開始日',
          '2093-04-01',
          '採用の経緯',
          '記録した時点の現行バージョン',
        ],
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('saves a meal set with repeated food quantities combined', async () => {
    const requests: Array<RequestRecord> = []
    const saveResponse = (body: unknown): Response => {
      const parsedInput = saveMealSetInputSchema.safeParse(body)
      if (!parsedInput.success) {
        return jsonResponse({ error: 'invalid request' }, 500)
      }
      return jsonResponse(
        {
          id: 'meal_set_fixture_001',
          name: parsedInput.data.name,
          items: parsedInput.data.items.map((item) => ({
            ...item,
            foodName: foodNameById[item.foodMasterId] ?? 'テスト食品_不明',
            energyKcalPerUnit: null,
          })),
          createdAt: '2093-04-12T00:00:00.000Z',
        },
        201,
      )
    }
    const { container, root, queryClient } = setupPage(saveResponse, requests)

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await waitFor(
        () =>
          container.querySelector(
            'button[aria-label="朝食をマイセットとして保存"]',
          ) !== null,
      )
      await submitMealSet(container, 'テストセット_001')
      await waitFor(() => container.querySelector('[role="status"]') !== null)

      expect(saveOutput(requests, container)).toEqual({
        requests: [expectedMealSetPost('テストセット_001')],
        output: {
          error: null,
          status: '「テストセット_001」をマイセットに保存しました。',
          formOpen: true,
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('prevents another save while the request is pending', async () => {
    const requests: Array<RequestRecord> = []
    let resolveSave: (response: Response) => void = () => undefined
    const pendingSave = new Promise<Response>((resolve) => {
      resolveSave = resolve
    })
    const { container, root, queryClient } = setupPage(
      () => pendingSave,
      requests,
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await waitFor(
        () =>
          container.querySelector(
            'button[aria-label="朝食をマイセットとして保存"]',
          ) !== null,
      )
      await submitMealSet(container, 'テストセット_001')

      const submitButton = container.querySelector<HTMLButtonElement>(
        '#meal-set-save-breakfast button[type="submit"]',
      )
      await waitFor(() => submitButton?.disabled === true)
      await performAct(() => {
        submitButton?.click()
      })

      expect(saveOutput(requests, container, submitButton)).toEqual({
        requests: [expectedMealSetPost('テストセット_001')],
        output: {
          error: null,
          status: null,
          formOpen: true,
          submitDisabled: true,
        },
      })

      resolveSave(
        jsonResponse(
          {
            id: 'meal_set_fixture_001',
            name: 'テストセット_001',
            items: [
              {
                foodMasterId: 'food_fixture_001',
                foodName: 'テスト食品_001',
                quantity: 3.25,
                energyKcalPerUnit: null,
              },
              {
                foodMasterId: 'food_fixture_002',
                foodName: 'テスト食品_002',
                quantity: 0.5,
                energyKcalPerUnit: null,
              },
            ],
            createdAt: '2093-04-12T00:00:00.000Z',
          },
          201,
        ),
      )
      await waitFor(() => container.querySelector('[role="status"]') !== null)
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('shows the duplicate-name reason returned by the API', async () => {
    const requests: Array<RequestRecord> = []
    const saveResponse = (body: unknown): Response => {
      const parsedInput = saveMealSetInputSchema.safeParse(body)
      if (!parsedInput.success) {
        return jsonResponse({ error: 'invalid request' }, 500)
      }
      return jsonResponse(
        {
          error: `meal_set with name already exists: ${parsedInput.data.name}`,
        },
        409,
      )
    }
    const { container, root, queryClient } = setupPage(saveResponse, requests)

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await waitFor(
        () =>
          container.querySelector(
            'button[aria-label="朝食をマイセットとして保存"]',
          ) !== null,
      )
      await submitMealSet(container, 'テストセット_001')
      await waitFor(() => container.querySelector('[role="alert"]') !== null)

      expect(saveOutput(requests, container)).toEqual({
        requests: [expectedMealSetPost('テストセット_001')],
        output: {
          error:
            '保存できませんでした: meal_set with name already exists: テストセット_001',
          status: null,
          formOpen: true,
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })
})
