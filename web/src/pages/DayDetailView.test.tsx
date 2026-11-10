import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  type DayDetail,
  type DayDetailEntry,
  MEAL_TYPES,
} from '#api/day-detail'
import type { MealPlan } from '#api/meal-plans'
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

const saveMealPlanInputSchema = z.object({
  reason: z.string().nullable(),
  items: z.array(
    z.object({
      foodMasterId: z.string(),
      foodName: z.string(),
      quantity: z.number(),
    }),
  ),
})

const recordMealLogsInputSchema = z.object({
  eatenDate: z.string(),
  mealType: z.enum(MEAL_TYPES),
  mealPlanId: z.string(),
  items: z.array(z.object({ foodMasterId: z.string(), quantity: z.number() })),
})

const foodSearchResult = {
  foodMasterId: 'fixture_food_a',
  compositionCode: null,
  name: '架空食品 A',
  isEstimated: false,
  nutritionStatus: 'confirmed',
  reason: 'fuzzy_name',
  source: 'web_search',
  energyKcalPerUnit: 125,
}

const foodNameById: Readonly<Record<string, string>> = {
  food_fixture_001: 'テスト食品_001',
  food_fixture_002: 'テスト食品_002',
}

const dayDetail: DayDetail = {
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

const mealPlanSaveOutput = (
  requests: ReadonlyArray<RequestRecord>,
  container: HTMLElement,
) => ({
  saveRequests: requests.filter((request) => request.method === 'PUT'),
  editorClosed: container.querySelector('[role="dialog"]') === null,
  plannedFoodIsNotInteractive: !Array.from(
    container.querySelectorAll<HTMLButtonElement>('button'),
  ).some((button) => button.textContent.includes('架空食品 A')),
  recordActionVisible: Array.from(
    container.querySelectorAll<HTMLButtonElement>('button'),
  ).some((button) => button.textContent === '食べた'),
})

const mealPlanCancelOutput = (
  initialView: {
    readonly summary: boolean
    readonly photoRequests: ReadonlyArray<RequestRecord>
    readonly nutritionRequests: ReadonlyArray<RequestRecord>
    readonly hasSkipAction: boolean
    readonly hasTomorrowLink: boolean
    readonly planItemIsButton: boolean
  },
  editSheet: { readonly label: string | null; readonly reason: string | null },
  requests: ReadonlyArray<RequestRecord>,
  container: HTMLElement,
) => ({
  initialView,
  editSheet,
  cancelRequests: requests.filter((request) => request.method === 'POST'),
  cancelledPlanHidden: !container.textContent.includes('架空食品 A'),
})

const planCancellationFailureOutput = (
  requests: ReadonlyArray<RequestRecord>,
  container: HTMLElement,
) => ({
  cancelRequests: requests.filter((request) => request.method === 'POST'),
  error: container.querySelector('[role="alert"]')?.textContent ?? null,
  planVisible: container.textContent.includes('架空食品 A'),
})

const plannedMealDisplayOutput = (container: HTMLElement) => ({
  statusLabel:
    Array.from(container.querySelectorAll<HTMLSpanElement>('span')).find(
      (span) => span.textContent === '予定',
    )?.textContent ?? null,
  memo: container.querySelector('[role="note"]')?.textContent ?? null,
})

const mealPlanRecordOutput = (
  requests: ReadonlyArray<RequestRecord>,
  container: HTMLElement,
  foodName: string,
  reason: string | null,
) => {
  return {
    recordRequests: requests.filter(
      (request) =>
        request.method === 'POST' && request.path === '/api/meal-logs',
    ),
    dayDetailReads: requests.filter((request) =>
      request.path.startsWith('/api/days/'),
    ).length,
    mealPlanReads: requests.filter((request) =>
      request.path.startsWith('/api/meal-plans?'),
    ).length,
    alert: container.querySelector('[role="alert"]')?.textContent ?? null,
    recordedFoodIsInteractive: Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).some((button) => button.textContent.includes(foodName)),
    planReasonVisible:
      reason !== null && container.textContent.includes(reason),
    sheetOpen: container.querySelector('[role="dialog"]') !== null,
  }
}

const mealPlanRecordCompleteOutput = (
  sheetDetails: {
    readonly label: string | null
    readonly notice: boolean
    readonly reasonField: boolean
    readonly submitLabel: string | undefined
  },
  requests: ReadonlyArray<RequestRecord>,
  container: HTMLElement,
) => ({
  sheetDetails,
  result: mealPlanRecordOutput(
    requests,
    container,
    '架空食品 A',
    '小腹が空いたときの予定',
  ),
})

const setTextareaValue = (
  textarea: HTMLTextAreaElement,
  value: string,
): Promise<void> =>
  performAct(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set?.bind(textarea)
    if (setter !== undefined) setter(value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
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
  mealPlans: ReadonlyArray<MealPlan> = [],
  cancelPlanResponse: (id: string) => Response = () =>
    new Response(null, { status: 204 }),
  recordMealLogsResponse: (body: unknown) => Response = () =>
    jsonResponse([], 201),
  concurrentMealLogState?: {
    readonly planId: string
    readonly entries: ReadonlyArray<DayDetailEntry>
  },
): {
  readonly container: HTMLDivElement
  readonly root: Root
  readonly queryClient: QueryClient
} => {
  let currentMealPlans = [...mealPlans]
  let currentDayEntries: ReadonlyArray<DayDetailEntry> = [...dayDetail.entries]
  vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
    Temporal.PlainDate.from('2093-04-12'),
  )
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
      if (method === 'POST' && path === '/api/meal-logs') {
        const response = recordMealLogsResponse(body)
        if (response.ok) {
          const parsedInput = recordMealLogsInputSchema.safeParse(body)
          if (!parsedInput.success) return Promise.resolve(response)
          const input = parsedInput.data
          const plan = currentMealPlans.find(
            ({ id }) => id === input.mealPlanId,
          )
          currentDayEntries = [
            ...currentDayEntries,
            ...input.items.map((item) => ({
              id: `meal_log_${item.foodMasterId}`,
              foodMasterId: item.foodMasterId,
              foodName:
                plan?.items.find(
                  ({ foodMasterId }) => foodMasterId === item.foodMasterId,
                )?.foodName ?? item.foodMasterId,
              eatenDate: input.eatenDate,
              mealType: input.mealType,
              quantity: item.quantity,
              kcal: 100,
              isEstimated: false,
              nutritionStatus: 'confirmed' as const,
              nutritionVersion: null,
              nutritionVersionOrigin: 'recorded' as const,
              nutritionVersionDifferences: [],
            })),
          ]
          currentMealPlans = currentMealPlans.filter(
            ({ id }) => id !== input.mealPlanId,
          )
        } else if (
          response.status === 409 &&
          concurrentMealLogState !== undefined
        ) {
          currentDayEntries = [
            ...currentDayEntries,
            ...concurrentMealLogState.entries,
          ]
          currentMealPlans = currentMealPlans.filter(
            ({ id }) => id !== concurrentMealLogState.planId,
          )
        }
        return Promise.resolve(response)
      }
      if (path.startsWith('/api/days/')) {
        const date = path.slice('/api/days/'.length)
        return Promise.resolve(
          jsonResponse({ ...dayDetail, date, entries: currentDayEntries }),
        )
      }
      if (path.startsWith('/api/meal-plans?')) {
        return Promise.resolve(jsonResponse(currentMealPlans))
      }
      if (method === 'POST' && path.startsWith('/api/meal-plans/')) {
        const id = decodeURIComponent(
          path.slice('/api/meal-plans/'.length, -'/cancel'.length),
        )
        const response = cancelPlanResponse(id)
        if (response.ok) {
          currentMealPlans = currentMealPlans.map((plan) =>
            plan.id === id ? { ...plan, status: 'cancelled' as const } : plan,
          )
        }
        return Promise.resolve(response)
      }
      if (method === 'PUT' && path.startsWith('/api/meal-plans/')) {
        const parsedInput = saveMealPlanInputSchema.safeParse(body)
        if (!parsedInput.success) {
          return Promise.resolve(
            jsonResponse({ error: 'invalid request' }, 400),
          )
        }
        const date = path.split('/')[3] ?? ''
        const plan: MealPlan = {
          id: 'plan_created_fixture',
          date,
          mealType: 'dinner',
          reason: parsedInput.data.reason,
          status: 'planned',
          items: parsedInput.data.items.map((item) => ({
            ...item,
            energyKcalPerUnit: 125,
          })),
        }
        currentMealPlans = [plan]
        return Promise.resolve(jsonResponse(plan))
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
      if (path.startsWith('/api/foods/suggestions?')) {
        return Promise.resolve(jsonResponse({ recent: [], frequent: [] }))
      }
      if (path.startsWith('/api/foods/search?')) {
        return Promise.resolve(jsonResponse({ items: [foodSearchResult] }))
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

const renderPage = (
  root: Root,
  queryClient: QueryClient,
  date = '2093-04-12',
): void => {
  root.render(
    <QueryClientProvider client={queryClient}>
      <MealLogSheetProvider>
        <MemoryRouter>
          <DayDetailView date={date} />
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
  vi.restoreAllMocks()
})

describe('DayDetailView', () => {
  it('creates a future meal plan through the shared food search and item form', async () => {
    const requests: Array<RequestRecord> = []
    const { container, root, queryClient } = setupPage(
      () => jsonResponse({}),
      requests,
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient, '2093-04-13')
      })
      await waitFor(() =>
        Array.from(container.querySelectorAll('button')).some(
          (button) => button.textContent === '予定を立てる',
        ),
      )
      await performAct(() => {
        const dinnerSection = Array.from(
          container.querySelectorAll<HTMLElement>('section'),
        ).find((section) => section.textContent.includes('夕食'))
        Array.from(
          dinnerSection?.querySelectorAll<HTMLButtonElement>('button') ?? [],
        )
          .find((button) => button.textContent === '予定を立てる')
          ?.click()
      })
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent.includes('食品を追加'))
          ?.click()
      })
      const searchInput = container.querySelector<HTMLInputElement>(
        'input[placeholder="食品名を入力"]',
      )
      if (searchInput !== null) await setInputValue(searchInput, '架空')
      await waitFor(() =>
        Array.from(container.querySelectorAll('button')).some((button) =>
          button.textContent.includes('架空食品 A'),
        ),
      )
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent.includes('架空食品 A'))
          ?.click()
      })
      const reasonInput =
        container.querySelector<HTMLTextAreaElement>('textarea')
      if (reasonInput !== null) {
        await setTextareaValue(reasonInput, '会議後の食事')
      }
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === '保存')
          ?.click()
      })
      await waitFor(() =>
        requests.some(
          (request) =>
            request.method === 'PUT' &&
            request.path === '/api/meal-plans/2093-04-13/dinner',
        ),
      )
      await waitFor(() => container.textContent.includes('架空食品 A'))

      expect(mealPlanSaveOutput(requests, container)).toEqual({
        saveRequests: [
          {
            method: 'PUT',
            path: '/api/meal-plans/2093-04-13/dinner',
            body: {
              reason: '会議後の食事',
              items: [
                {
                  foodMasterId: 'fixture_food_a',
                  foodName: '架空食品 A',
                  quantity: 1,
                },
              ],
            },
          },
        ],
        editorClosed: true,
        plannedFoodIsNotInteractive: true,
        recordActionVisible: false,
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('records an edited meal plan and refreshes the day and plan views', async () => {
    const requests: Array<RequestRecord> = []
    const plan: MealPlan = {
      id: 'plan_record_fixture',
      date: '2093-04-12',
      mealType: 'snack',
      reason: '小腹が空いたときの予定',
      status: 'planned',
      items: [
        {
          foodMasterId: 'fixture_food_a',
          foodName: '架空食品 A',
          quantity: 1.5,
          energyKcalPerUnit: 125,
        },
      ],
    }
    const { container, root, queryClient } = setupPage(
      () => jsonResponse({}),
      requests,
      [plan],
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await waitFor(() => container.textContent.includes('架空食品 A'))
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === '食べた')
          ?.click()
      })

      const sheetDetails = {
        label:
          container
            .querySelector('[role="dialog"]')
            ?.getAttribute('aria-label') ?? null,
        notice: container.textContent.includes(
          '日付と食事区分は予定のまま記録します。',
        ),
        reasonField: container.querySelector('textarea') !== null,
        submitLabel: Array.from(
          container.querySelectorAll<HTMLButtonElement>('button'),
        ).find((button) => button.textContent === 'まとめて記録')?.textContent,
      }
      const quantityInput = container.querySelector<HTMLInputElement>(
        'input[aria-label="架空食品 A の量"]',
      )
      if (quantityInput !== null) {
        await setInputValue(quantityInput, '2.25')
      }
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === 'まとめて記録')
          ?.click()
      })
      await waitFor(() =>
        requests.some(
          (request) =>
            request.method === 'POST' && request.path === '/api/meal-logs',
        ),
      )
      await waitFor(
        () =>
          requests.filter((request) => request.path.startsWith('/api/days/'))
            .length > 1 &&
          requests.filter((request) =>
            request.path.startsWith('/api/meal-plans?'),
          ).length > 1 &&
          mealPlanRecordOutput(
            requests,
            container,
            '架空食品 A',
            '小腹が空いたときの予定',
          ).recordedFoodIsInteractive &&
          !mealPlanRecordOutput(
            requests,
            container,
            '架空食品 A',
            '小腹が空いたときの予定',
          ).planReasonVisible &&
          container.querySelector('[role="dialog"]') === null,
      )

      expect(
        mealPlanRecordCompleteOutput(sheetDetails, requests, container),
      ).toEqual({
        sheetDetails: {
          label: '予定を記録',
          notice: true,
          reasonField: false,
          submitLabel: 'まとめて記録',
        },
        result: {
          recordRequests: [
            {
              method: 'POST',
              path: '/api/meal-logs',
              body: {
                eatenDate: '2093-04-12',
                mealType: 'snack',
                mealPlanId: 'plan_record_fixture',
                items: [{ foodMasterId: 'fixture_food_a', quantity: 2.25 }],
              },
            },
          ],
          dayDetailReads: 2,
          mealPlanReads: 2,
          alert: null,
          recordedFoodIsInteractive: true,
          planReasonVisible: false,
          sheetOpen: false,
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('refreshes without showing an error when the meal plan was already recorded', async () => {
    const requests: Array<RequestRecord> = []
    const plan: MealPlan = {
      id: 'plan_conflict_fixture',
      date: '2093-04-12',
      mealType: 'snack',
      reason: null,
      status: 'planned',
      items: [
        {
          foodMasterId: 'fixture_food_b',
          foodName: '架空食品 B',
          quantity: 1,
          energyKcalPerUnit: 90,
        },
      ],
    }
    const concurrentEntry: DayDetailEntry = {
      id: 'meal_log_concurrent_fixture',
      foodMasterId: 'fixture_food_c',
      foodName: '架空食品 C',
      eatenDate: '2093-04-12',
      mealType: 'snack',
      quantity: 4,
      kcal: 400,
      isEstimated: false,
      nutritionStatus: 'confirmed',
      nutritionVersion: null,
      nutritionVersionOrigin: 'recorded',
      nutritionVersionDifferences: [],
    }
    const { container, root, queryClient } = setupPage(
      () => jsonResponse({}),
      requests,
      [plan],
      undefined,
      () => jsonResponse({ error: 'already eaten' }, 409),
      { planId: plan.id, entries: [concurrentEntry] },
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await waitFor(() => container.textContent.includes('架空食品 B'))
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === '食べた')
          ?.click()
      })
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === 'まとめて記録')
          ?.click()
      })
      await waitFor(
        () =>
          requests.filter((request) => request.path.startsWith('/api/days/'))
            .length > 1 &&
          requests.filter((request) =>
            request.path.startsWith('/api/meal-plans?'),
          ).length > 1 &&
          mealPlanRecordOutput(requests, container, '架空食品 C', null)
            .recordedFoodIsInteractive &&
          container.querySelector('[role="dialog"]') === null,
      )

      expect(
        mealPlanRecordOutput(requests, container, '架空食品 C', null),
      ).toEqual({
        recordRequests: [
          {
            method: 'POST',
            path: '/api/meal-logs',
            body: {
              eatenDate: '2093-04-12',
              mealType: 'snack',
              mealPlanId: 'plan_conflict_fixture',
              items: [{ foodMasterId: 'fixture_food_b', quantity: 1 }],
            },
          },
        ],
        dayDetailReads: 2,
        mealPlanReads: 2,
        alert: null,
        recordedFoodIsInteractive: true,
        planReasonVisible: false,
        sheetOpen: false,
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('shows a recording error and keeps the plan sheet open', async () => {
    const requests: Array<RequestRecord> = []
    const plan: MealPlan = {
      id: 'plan_record_failure_fixture',
      date: '2093-04-12',
      mealType: 'snack',
      reason: '軽食の予定',
      status: 'planned',
      items: [
        {
          foodMasterId: 'fixture_food_b',
          foodName: '架空食品 B',
          quantity: 1,
          energyKcalPerUnit: 90,
        },
      ],
    }
    const { container, root, queryClient } = setupPage(
      () => jsonResponse({}),
      requests,
      [plan],
      undefined,
      () => jsonResponse({ error: '記録できませんでした。' }, 400),
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await waitFor(() => container.textContent.includes('架空食品 B'))
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === '食べた')
          ?.click()
      })
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === 'まとめて記録')
          ?.click()
      })
      await waitFor(
        () =>
          container.querySelector('[role="alert"]')?.textContent ===
          '記録できませんでした。',
      )

      expect(
        mealPlanRecordOutput(requests, container, '架空食品 B', '軽食の予定'),
      ).toEqual({
        recordRequests: [
          {
            method: 'POST',
            path: '/api/meal-logs',
            body: {
              eatenDate: '2093-04-12',
              mealType: 'snack',
              mealPlanId: 'plan_record_failure_fixture',
              items: [{ foodMasterId: 'fixture_food_b', quantity: 1 }],
            },
          },
        ],
        dayDetailReads: 1,
        mealPlanReads: 1,
        alert: '記録できませんでした。',
        recordedFoodIsInteractive: false,
        planReasonVisible: true,
        sheetOpen: true,
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('replaces a planned food and preserves its quantity when saving edits', async () => {
    const requests: Array<RequestRecord> = []
    const plan: MealPlan = {
      id: 'plan_existing_fixture',
      date: '2093-04-13',
      mealType: 'dinner',
      reason: '作業後に食べる予定',
      status: 'planned',
      items: [
        {
          foodMasterId: 'fixture_food_b',
          foodName: '架空食品 B',
          quantity: 2.5,
          energyKcalPerUnit: 90,
        },
      ],
    }
    const { container, root, queryClient } = setupPage(
      () => jsonResponse({}),
      requests,
      [plan],
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient, '2093-04-13')
      })
      await waitFor(() => container.textContent.includes('架空食品 B'))
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === '予定を変更')
          ?.click()
      })
      await waitFor(
        () =>
          container.querySelector(
            'button[aria-label="架空食品 B を差し替え"]',
          ) !== null,
      )
      await performAct(() => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="架空食品 B を差し替え"]',
          )
          ?.click()
      })
      const searchInput = container.querySelector<HTMLInputElement>(
        'input[placeholder="食品名を入力"]',
      )
      if (searchInput !== null) await setInputValue(searchInput, '架空')
      await waitFor(() =>
        Array.from(container.querySelectorAll('button')).some((button) =>
          button.textContent.includes('架空食品 A'),
        ),
      )
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent.includes('架空食品 A'))
          ?.click()
      })
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === '保存')
          ?.click()
      })
      await waitFor(() =>
        requests.some(
          (request) =>
            request.method === 'PUT' &&
            request.path === '/api/meal-plans/2093-04-13/dinner',
        ),
      )

      expect(mealPlanSaveOutput(requests, container)).toEqual({
        saveRequests: [
          {
            method: 'PUT',
            path: '/api/meal-plans/2093-04-13/dinner',
            body: {
              reason: '作業後に食べる予定',
              items: [
                {
                  foodMasterId: 'fixture_food_a',
                  foodName: '架空食品 A',
                  quantity: 2.5,
                },
              ],
            },
          },
        ],
        editorClosed: true,
        plannedFoodIsNotInteractive: true,
        recordActionVisible: false,
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('shows a future plan without meal-log controls, photos, or nutrition summary', async () => {
    const requests: Array<RequestRecord> = []
    const plan: MealPlan = {
      id: 'plan_fixture_001',
      date: '2093-04-13',
      mealType: 'dinner',
      reason: '作業後の予定',
      status: 'planned',
      items: [
        {
          foodMasterId: 'fixture_food_a',
          foodName: '架空食品 A',
          quantity: 1.5,
          energyKcalPerUnit: 125,
        },
      ],
    }
    const { container, root, queryClient } = setupPage(
      () => jsonResponse({}),
      requests,
      [plan],
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient, '2093-04-13')
      })
      await waitFor(() => container.textContent.includes('架空食品 A'))

      const planItem = Array.from(
        container.querySelectorAll<HTMLDivElement>('div'),
      ).find((element) => element.textContent.includes('架空食品 A'))
      const initialView = {
        summary: container.textContent.includes('NUTRITION'),
        photoRequests: requests.filter((request) =>
          request.path.startsWith('/api/meal-photos/'),
        ),
        nutritionRequests: requests.filter((request) =>
          ['/api/nutrient-definitions', '/api/profile'].includes(request.path),
        ),
        hasSkipAction: Array.from(container.querySelectorAll('button')).some(
          (button) => button.textContent === '食べなかった',
        ),
        hasTomorrowLink: Array.from(container.querySelectorAll('a')).some(
          (link) => link.textContent === '翌日 →',
        ),
        plannedMeal: plannedMealDisplayOutput(container),
        planItemIsButton:
          planItem !== undefined && planItem.closest('button') !== null,
      }
      const changeButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent === '予定を変更')
      await performAct(() => {
        changeButton?.click()
      })
      const editSheet = {
        label:
          container
            .querySelector('[role="dialog"]')
            ?.getAttribute('aria-label') ?? null,
        reason:
          container.querySelector<HTMLTextAreaElement>('textarea')?.value ??
          null,
      }
      await performAct(() => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')
          ?.click()
      })
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === '取り消す')
          ?.click()
      })
      await waitFor(() =>
        requests.some(
          (request) =>
            request.method === 'POST' &&
            request.path === '/api/meal-plans/plan_fixture_001/cancel',
        ),
      )
      await waitFor(() => !container.textContent.includes('架空食品 A'))

      expect(
        mealPlanCancelOutput(initialView, editSheet, requests, container),
      ).toEqual({
        initialView: {
          summary: false,
          photoRequests: [],
          nutritionRequests: [],
          hasSkipAction: false,
          hasTomorrowLink: true,
          plannedMeal: {
            statusLabel: '予定',
            memo: 'メモ: 作業後の予定',
          },
          planItemIsButton: false,
        },
        editSheet: { label: '予定を変更', reason: '作業後の予定' },
        cancelRequests: [
          {
            method: 'POST',
            path: '/api/meal-plans/plan_fixture_001/cancel',
            body: null,
          },
        ],
        cancelledPlanHidden: true,
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('omits the memo when a meal plan has no reason', async () => {
    const requests: Array<RequestRecord> = []
    const plan: MealPlan = {
      id: 'plan_without_reason_fixture',
      date: '2093-04-13',
      mealType: 'dinner',
      reason: null,
      status: 'planned',
      items: [
        {
          foodMasterId: 'fixture_food_a',
          foodName: '架空食品 A',
          quantity: 1,
          energyKcalPerUnit: 125,
        },
      ],
    }
    const { container, root, queryClient } = setupPage(
      () => jsonResponse({}),
      requests,
      [plan],
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient, '2093-04-13')
      })
      await waitFor(() => container.textContent.includes('架空食品 A'))

      expect(plannedMealDisplayOutput(container)).toEqual({
        statusLabel: '予定',
        memo: null,
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('shows the plan when cancellation fails and explains the error', async () => {
    const requests: Array<RequestRecord> = []
    const plan: MealPlan = {
      id: 'plan_cancel_failure_fixture',
      date: '2093-04-13',
      mealType: 'dinner',
      reason: '作業後に食べる予定',
      status: 'planned',
      items: [
        {
          foodMasterId: 'fixture_food_a',
          foodName: '架空食品 A',
          quantity: 1,
          energyKcalPerUnit: 125,
        },
      ],
    }
    const { container, root, queryClient } = setupPage(
      () => jsonResponse({}),
      requests,
      [plan],
      () => jsonResponse({ error: 'この予定は取り消せません。' }, 409),
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient, '2093-04-13')
      })
      await waitFor(() => container.textContent.includes('架空食品 A'))
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === '取り消す')
          ?.click()
      })
      await waitFor(() => container.querySelector('[role="alert"]') !== null)

      expect(planCancellationFailureOutput(requests, container)).toEqual({
        cancelRequests: [
          {
            method: 'POST',
            path: '/api/meal-plans/plan_cancel_failure_fixture/cancel',
            body: null,
          },
        ],
        error: 'この予定は取り消せません。',
        planVisible: true,
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

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
