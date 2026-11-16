import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { BodyWeight } from '#api/body-weights'
import { HistoryPage } from '#pages/HistoryPage'
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

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 40 && !condition(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

const bodyWeightRequests = (requests: ReadonlyArray<RequestRecord>) =>
  requests.filter((request) => request.path.startsWith('/api/body-weights'))

const visibleRecords = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-record-id]')).map(
    (article) => ({
      id: article.dataset.recordId,
      date: article.querySelector('h3')?.textContent,
      time: article.querySelector('p')?.textContent ?? null,
      weight: article.querySelector('strong')?.textContent,
    }),
  )

const createdMeasurementOutput = (
  requests: ReadonlyArray<RequestRecord>,
  container: HTMLElement,
) => ({
  requests: bodyWeightRequests(requests),
  records: visibleRecords(container),
  editor: {
    date: container.querySelector<HTMLInputElement>('input[type="date"]')
      ?.value,
    weight: container.querySelector<HTMLInputElement>('input[type="number"]')
      ?.value,
  },
})

const correctedMeasurementOutput = (
  requests: ReadonlyArray<RequestRecord>,
  container: HTMLElement,
) => ({
  requests: bodyWeightRequests(requests),
  records: visibleRecords(container),
  formTitle: container.querySelector('form h2')?.textContent,
})

const editedTimePreservationOutput = (
  requests: ReadonlyArray<RequestRecord>,
  container: HTMLElement,
) => ({
  requests: bodyWeightRequests(requests),
  records: visibleRecords(container),
  formTitle: container.querySelector('form h2')?.textContent,
})

const deletedMeasurementOutput = (
  requestCountBeforeConfirm: number,
  dialogVisible: boolean,
  requests: ReadonlyArray<RequestRecord>,
  container: HTMLElement,
) => ({
  requestCountBeforeConfirm,
  dialogVisible,
  requests: bodyWeightRequests(requests),
  records: visibleRecords(container),
  dialogAfterDelete: container.querySelector('[role="alertdialog"]'),
  form: {
    title: container.querySelector('form h2')?.textContent,
    date: container.querySelector<HTMLInputElement>('input[type="date"]')
      ?.value,
    weight: container.querySelector<HTMLInputElement>('input[type="number"]')
      ?.value,
    time: container.querySelector<HTMLInputElement>('input[type="time"]')
      ?.value,
  },
})

const validationErrorOutput = (
  requests: ReadonlyArray<RequestRecord>,
  container: HTMLElement,
) => ({
  requests: bodyWeightRequests(requests),
  error: container.querySelector('[role="alert"]')?.textContent,
})

const currentPeriodLabel = (container: HTMLElement): string | null =>
  container
    .querySelector('[aria-label="前の期間"]')
    ?.parentElement?.querySelector('span')?.textContent ?? null

const periodNavigationOutput = (
  requests: ReadonlyArray<RequestRecord>,
  labels: ReadonlyArray<string | null>,
) => ({
  requests: bodyWeightRequests(requests),
  labels,
})

const savedRecord = (input: {
  readonly id: string
  readonly date: string
  readonly weightKg: number
  readonly measuredAt: string | null
}): BodyWeight => ({
  ...input,
  createdAt: '2026-07-05T00:00:00.000Z',
  updatedAt: '2026-07-05T00:00:00.000Z',
})

const createInputSchema = z.object({
  date: z.string(),
  weightKg: z.number(),
  measuredAt: z.string(),
})

const updateInputSchema = z.object({
  date: z.string(),
  weightKg: z.number(),
  measuredAt: z.string().nullable().optional(),
})

const setupPage = (
  fetchHandler: (path: string, method: string, body: unknown) => Response,
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

      if (path === '/api/profile') {
        return Promise.resolve(
          jsonResponse({
            likes: [],
            dislikes: [],
            allergies: [],
            constraints: [],
            dailyTargets: null,
          }),
        )
      }
      if (path === '/api/nutrient-definitions') {
        return Promise.resolve(jsonResponse([]))
      }
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
        return Promise.resolve(jsonResponse([]))
      }
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
  return { container, root, queryClient, requests }
}

const renderPage = (root: Root, queryClient: QueryClient): void => {
  root.render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const openBodyWeightTab = async (container: HTMLElement): Promise<void> => {
  await waitFor(() => container.querySelector('button') !== null)
  const tab = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === '体重',
  )
  await performAct(() => {
    tab?.click()
  })
  await waitFor(
    () =>
      visibleRecords(container).length > 0 ||
      container.textContent.includes('この期間の記録はありません'),
  )
}

const clickButton = async (
  container: HTMLElement,
  selector: string,
): Promise<void> => {
  const button = container.querySelector<HTMLButtonElement>(selector)
  await performAct(() => {
    button?.click()
  })
}

const clickButtonByText = async (
  container: HTMLElement,
  text: string,
): Promise<void> => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === text,
  )
  await performAct(() => {
    button?.click()
  })
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

describe('HistoryPage body-weight tab', () => {
  it('adds a measurement with its date and optional time', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const records: BodyWeight[] = []
    const { container, root, queryClient, requests } = setupPage(
      (path, method, body) => {
        if (path === '/api/body-weights?from=2026-06-29&to=2026-07-05') {
          return jsonResponse(records)
        }
        if (path === '/api/body-weights' && method === 'POST') {
          const input = createInputSchema.parse(body)
          const saved = savedRecord({
            id: 'weight_demo_alpha',
            date: input.date,
            weightKg: input.weightKg,
            measuredAt: new Date(input.measuredAt).toISOString(),
          })
          records.push(saved)
          return jsonResponse(saved, 201)
        }
        return jsonResponse({ error: 'unexpected request' }, 500)
      },
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)
      const weightInput = container.querySelector<HTMLInputElement>(
        'input[type="number"]',
      )
      const timeInput =
        container.querySelector<HTMLInputElement>('input[type="time"]')
      if (weightInput !== null) await setInputValue(weightInput, '68.5')
      if (timeInput !== null) await setInputValue(timeInput, '07:40')
      await clickButton(container, 'button[type="submit"]')
      await waitFor(() => visibleRecords(container).length === 1)

      expect(createdMeasurementOutput(requests, container)).toEqual({
        requests: [
          {
            method: 'GET',
            path: '/api/body-weights?from=2026-06-29&to=2026-07-05',
            body: null,
          },
          {
            method: 'POST',
            path: '/api/body-weights',
            body: {
              date: '2026-07-05',
              weightKg: 68.5,
              measuredAt: '2026-07-05T07:40:00+09:00',
            },
          },
          {
            method: 'GET',
            path: '/api/body-weights?from=2026-06-29&to=2026-07-05',
            body: null,
          },
        ],
        records: [
          {
            id: 'weight_demo_alpha',
            date: '2026年7月5日',
            time: '07:40',
            weight: '68.5 kg',
          },
        ],
        editor: { date: '2026-07-05', weight: '' },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('corrects an existing measurement and clears its optional time', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const record = savedRecord({
      id: 'weight_demo_beta',
      date: '2026-07-04',
      weightKg: 63.4,
      measuredAt: '2026-07-04T00:30:00.000Z',
    })
    const records: BodyWeight[] = [record]
    const { container, root, queryClient, requests } = setupPage(
      (path, method, body) => {
        if (path === '/api/body-weights?from=2026-06-29&to=2026-07-05') {
          return jsonResponse(records)
        }
        if (
          path === '/api/body-weights/weight_demo_beta' &&
          method === 'PATCH'
        ) {
          const input = updateInputSchema.parse(body)
          const saved = savedRecord({
            ...record,
            date: input.date,
            weightKg: input.weightKg,
            measuredAt:
              input.measuredAt === undefined
                ? record.measuredAt
                : input.measuredAt,
          })
          records[0] = saved
          return jsonResponse(saved)
        }
        return jsonResponse({ error: 'unexpected request' }, 500)
      },
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)
      await clickButton(container, 'button[aria-label="訂正 2026年7月4日"]')
      const weightInput = container.querySelector<HTMLInputElement>(
        'input[type="number"]',
      )
      const timeInput =
        container.querySelector<HTMLInputElement>('input[type="time"]')
      if (weightInput !== null) await setInputValue(weightInput, '63.5')
      if (timeInput !== null) await setInputValue(timeInput, '')
      await clickButton(container, 'button[type="submit"]')
      await waitFor(() => visibleRecords(container)[0]?.weight === '63.5 kg')

      expect(correctedMeasurementOutput(requests, container)).toEqual({
        requests: [
          {
            method: 'GET',
            path: '/api/body-weights?from=2026-06-29&to=2026-07-05',
            body: null,
          },
          {
            method: 'PATCH',
            path: '/api/body-weights/weight_demo_beta',
            body: {
              date: '2026-07-04',
              weightKg: 63.5,
              measuredAt: null,
            },
          },
          {
            method: 'GET',
            path: '/api/body-weights?from=2026-06-29&to=2026-07-05',
            body: null,
          },
        ],
        records: [
          {
            id: 'weight_demo_beta',
            date: '2026年7月4日',
            time: null,
            weight: '63.5 kg',
          },
        ],
        formTitle: '体重を記録',
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('preserves measurement seconds when only the weight changes', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const record = savedRecord({
      id: 'weight_demo_seconds',
      date: '2026-07-04',
      weightKg: 63.4,
      measuredAt: '2026-07-04T00:30:45.000Z',
    })
    const records: BodyWeight[] = [record]
    const { container, root, queryClient, requests } = setupPage(
      (path, method, body) => {
        if (path === '/api/body-weights?from=2026-06-29&to=2026-07-05') {
          return jsonResponse(records)
        }
        if (
          path === '/api/body-weights/weight_demo_seconds' &&
          method === 'PATCH'
        ) {
          const input = updateInputSchema.parse(body)
          const saved = savedRecord({
            ...record,
            date: input.date,
            weightKg: input.weightKg,
            measuredAt:
              input.measuredAt === undefined
                ? record.measuredAt
                : input.measuredAt,
          })
          records[0] = saved
          return jsonResponse(saved)
        }
        return jsonResponse({ error: 'unexpected request' }, 500)
      },
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)
      await clickButton(container, 'button[aria-label="訂正 2026年7月4日"]')
      const weightInput = container.querySelector<HTMLInputElement>(
        'input[type="number"]',
      )
      if (weightInput !== null) await setInputValue(weightInput, '64.2')
      await clickButton(container, 'button[type="submit"]')
      await waitFor(() => visibleRecords(container)[0]?.weight === '64.2 kg')

      expect(editedTimePreservationOutput(requests, container)).toEqual({
        requests: [
          {
            method: 'GET',
            path: '/api/body-weights?from=2026-06-29&to=2026-07-05',
            body: null,
          },
          {
            method: 'PATCH',
            path: '/api/body-weights/weight_demo_seconds',
            body: { date: '2026-07-04', weightKg: 64.2 },
          },
          {
            method: 'GET',
            path: '/api/body-weights?from=2026-06-29&to=2026-07-05',
            body: null,
          },
        ],
        records: [
          {
            id: 'weight_demo_seconds',
            date: '2026年7月4日',
            time: '09:30',
            weight: '64.2 kg',
          },
        ],
        formTitle: '体重を記録',
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('deletes a measurement after confirmation and exits its edit form', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const records: BodyWeight[] = [
      savedRecord({
        id: 'weight_demo_gamma',
        date: '2026-07-04',
        weightKg: 63.4,
        measuredAt: null,
      }),
    ]
    const { container, root, queryClient, requests } = setupPage(
      (path, method) => {
        if (path === '/api/body-weights?from=2026-06-29&to=2026-07-05') {
          return jsonResponse(records)
        }
        if (
          path === '/api/body-weights/weight_demo_gamma' &&
          method === 'DELETE'
        ) {
          records.splice(0, 1)
          return new Response(null, { status: 204 })
        }
        return jsonResponse({ error: 'unexpected request' }, 500)
      },
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)
      await clickButton(container, 'button[aria-label="訂正 2026年7月4日"]')
      await waitFor(
        () => container.querySelector('form h2')?.textContent === '記録を訂正',
      )
      await clickButton(container, 'button[aria-label="削除 2026年7月4日"]')
      const requestCountBeforeConfirm = bodyWeightRequests(requests).length
      const dialogVisible =
        container.querySelector('[role="alertdialog"]') !== null
      await clickButton(container, 'button[aria-label="記録を削除"]')
      await waitFor(
        () =>
          visibleRecords(container).length === 0 &&
          container.querySelector('form h2')?.textContent === '体重を記録',
      )

      expect(
        deletedMeasurementOutput(
          requestCountBeforeConfirm,
          dialogVisible,
          requests,
          container,
        ),
      ).toEqual({
        requestCountBeforeConfirm: 1,
        dialogVisible: true,
        requests: [
          {
            method: 'GET',
            path: '/api/body-weights?from=2026-06-29&to=2026-07-05',
            body: null,
          },
          {
            method: 'DELETE',
            path: '/api/body-weights/weight_demo_gamma',
            body: null,
          },
          {
            method: 'GET',
            path: '/api/body-weights?from=2026-06-29&to=2026-07-05',
            body: null,
          },
        ],
        records: [],
        dialogAfterDelete: null,
        form: {
          title: '体重を記録',
          date: '2026-07-05',
          weight: '',
          time: '',
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('shows a server validation error beside the form', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const { container, root, queryClient, requests } = setupPage(
      (path, method) => {
        if (path === '/api/body-weights?from=2026-06-29&to=2026-07-05') {
          return jsonResponse([])
        }
        if (path === '/api/body-weights' && method === 'POST') {
          return jsonResponse(
            { error: 'body weight date is in the future' },
            400,
          )
        }
        return jsonResponse({ error: 'unexpected request' }, 500)
      },
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)
      const dateInput =
        container.querySelector<HTMLInputElement>('input[type="date"]')
      const weightInput = container.querySelector<HTMLInputElement>(
        'input[type="number"]',
      )
      if (dateInput !== null) await setInputValue(dateInput, '2026-07-06')
      if (weightInput !== null) await setInputValue(weightInput, '68.5')
      await clickButton(container, 'button[type="submit"]')
      await waitFor(() => container.querySelector('[role="alert"]') !== null)

      expect(validationErrorOutput(requests, container)).toEqual({
        requests: [
          {
            method: 'GET',
            path: '/api/body-weights?from=2026-06-29&to=2026-07-05',
            body: null,
          },
          {
            method: 'POST',
            path: '/api/body-weights',
            body: { date: '2026-07-06', weightKg: 68.5 },
          },
        ],
        error: 'body weight date is in the future',
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('loads inclusive ranges for 30 days and older periods', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const { container, root, queryClient, requests } = setupPage((path) => {
      if (path.startsWith('/api/body-weights?')) return jsonResponse([])
      return jsonResponse({ error: 'unexpected request' }, 500)
    })

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)
      const labels: Array<string | null> = [currentPeriodLabel(container)]

      await clickButtonByText(container, '30 日')
      await waitFor(
        () =>
          bodyWeightRequests(requests).length === 2 &&
          currentPeriodLabel(container) === '2026-06-06 – 2026-07-05',
      )
      labels.push(currentPeriodLabel(container))

      await clickButton(container, 'button[aria-label="前の期間"]')
      await waitFor(
        () =>
          bodyWeightRequests(requests).length === 3 &&
          currentPeriodLabel(container) === '2026-05-07 – 2026-06-05',
      )
      labels.push(currentPeriodLabel(container))

      await clickButton(container, 'button[aria-label="次の期間"]')
      await waitFor(
        () => currentPeriodLabel(container) === '2026-06-06 – 2026-07-05',
      )
      labels.push(currentPeriodLabel(container))

      expect(periodNavigationOutput(requests, labels)).toEqual({
        requests: [
          {
            method: 'GET',
            path: '/api/body-weights?from=2026-06-29&to=2026-07-05',
            body: null,
          },
          {
            method: 'GET',
            path: '/api/body-weights?from=2026-06-06&to=2026-07-05',
            body: null,
          },
          {
            method: 'GET',
            path: '/api/body-weights?from=2026-05-07&to=2026-06-05',
            body: null,
          },
        ],
        labels: [
          '2026-06-29 – 2026-07-05',
          '2026-06-06 – 2026-07-05',
          '2026-05-07 – 2026-06-05',
          '2026-06-06 – 2026-07-05',
        ],
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })
})
