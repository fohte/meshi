import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { BodyComposition } from '#api/body-compositions'
import type { BodyWeight } from '#api/body-weights'
import { HistoryPage } from '#pages/HistoryPage'
import { performAct, setInputValue } from '#test/test-helpers'

interface RequestRecord {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

const ALL_BODY_COMPOSITIONS_RANGE =
  '/api/body-compositions?from=0001-01-01&to=9999-12-31'
const COMPOSITION_ESTIMATE_NOTE =
  '体組成計による推定値です。機器が違う値は比べられません。'

const bodyCompositionInputSchema = z.object({
  date: z.string(),
  measuredAt: z.string().optional(),
  device: z.string(),
  bodyFatPercent: z.number().optional(),
  muscleMassKg: z.number().optional(),
  skeletalMusclePercent: z.number().optional(),
})

const bodyCompositionUpdateSchema = z.object({
  date: z.string().optional(),
  measuredAt: z.string().nullable().optional(),
  device: z.string().optional(),
  bodyFatPercent: z.number().nullable().optional(),
  muscleMassKg: z.number().nullable().optional(),
  skeletalMusclePercent: z.number().nullable().optional(),
})

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const bodyCompositionRequests = (requests: ReadonlyArray<RequestRecord>) =>
  requests.filter((request) =>
    request.path.startsWith('/api/body-compositions'),
  )

const savedComposition = (
  input: Pick<BodyComposition, 'id' | 'date' | 'device'> &
    Partial<
      Pick<
        BodyComposition,
        | 'measuredAt'
        | 'bodyFatPercent'
        | 'muscleMassKg'
        | 'skeletalMusclePercent'
      >
    >,
): BodyComposition => ({
  id: input.id,
  date: input.date,
  measuredAt: input.measuredAt ?? null,
  device: input.device,
  bodyFatPercent: input.bodyFatPercent ?? null,
  muscleMassKg: input.muscleMassKg ?? null,
  skeletalMusclePercent: input.skeletalMusclePercent ?? null,
  createdAt: '2031-04-12T00:20:00.000Z',
  updatedAt: '2031-04-12T00:20:00.000Z',
})

const setupPage = (
  weights: Array<BodyWeight>,
  compositions: Array<BodyComposition>,
  compositionPostError?: string,
  compositionLoadError?: string,
  latestDeviceLoadErrorOnce?: string,
): {
  readonly container: HTMLDivElement
  readonly root: Root
  readonly queryClient: QueryClient
  readonly requests: Array<RequestRecord>
} => {
  const requests: Array<RequestRecord> = []
  let shouldFailLatestDeviceLoad = latestDeviceLoadErrorOnce !== undefined
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
      if (path === '/api/nutrient-definitions')
        return Promise.resolve(jsonResponse([]))
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
      if (path.startsWith('/api/body-weights?')) {
        return Promise.resolve(jsonResponse(weights))
      }
      if (path.startsWith('/api/body-compositions?')) {
        const { searchParams } = new URL(path, 'http://meshi.test')
        const from = searchParams.get('from') ?? ''
        const to = searchParams.get('to') ?? ''
        if (
          path === ALL_BODY_COMPOSITIONS_RANGE &&
          shouldFailLatestDeviceLoad
        ) {
          shouldFailLatestDeviceLoad = false
          return Promise.resolve(
            jsonResponse({ error: latestDeviceLoadErrorOnce }, 500),
          )
        }
        if (
          compositionLoadError !== undefined &&
          path !== ALL_BODY_COMPOSITIONS_RANGE
        ) {
          return Promise.resolve(
            jsonResponse({ error: compositionLoadError }, 500),
          )
        }
        return Promise.resolve(
          jsonResponse(
            compositions.filter(
              (record) => record.date >= from && record.date <= to,
            ),
          ),
        )
      }
      if (path === '/api/body-compositions' && method === 'POST') {
        if (compositionPostError !== undefined) {
          return Promise.resolve(
            jsonResponse({ error: compositionPostError }, 400),
          )
        }
        const inputValue = bodyCompositionInputSchema.parse(body)
        const record = savedComposition({
          id: 'composition_demo_created',
          date: inputValue.date,
          device: inputValue.device,
          measuredAt:
            inputValue.measuredAt === undefined
              ? null
              : new Date(inputValue.measuredAt).toISOString(),
          bodyFatPercent: inputValue.bodyFatPercent ?? null,
          muscleMassKg: inputValue.muscleMassKg ?? null,
          skeletalMusclePercent: inputValue.skeletalMusclePercent ?? null,
        })
        compositions.push(record)
        return Promise.resolve(jsonResponse(record, 201))
      }
      if (
        path === '/api/body-compositions/composition_demo_created' &&
        method === 'PATCH'
      ) {
        const inputValue = bodyCompositionUpdateSchema.parse(body)
        const existing = compositions.find(
          (record) => record.id === 'composition_demo_created',
        )
        if (existing === undefined) {
          return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
        }
        const record = savedComposition({
          ...existing,
          ...inputValue,
          id: existing.id,
          date: inputValue.date ?? existing.date,
          device: inputValue.device ?? existing.device,
          measuredAt:
            inputValue.measuredAt === undefined
              ? existing.measuredAt
              : inputValue.measuredAt === null
                ? null
                : new Date(inputValue.measuredAt).toISOString(),
          bodyFatPercent:
            inputValue.bodyFatPercent === undefined
              ? existing.bodyFatPercent
              : inputValue.bodyFatPercent,
          muscleMassKg:
            inputValue.muscleMassKg === undefined
              ? existing.muscleMassKg
              : inputValue.muscleMassKg,
          skeletalMusclePercent:
            inputValue.skeletalMusclePercent === undefined
              ? existing.skeletalMusclePercent
              : inputValue.skeletalMusclePercent,
        })
        compositions[compositions.indexOf(existing)] = record
        return Promise.resolve(jsonResponse(record))
      }
      if (
        path === '/api/body-compositions/composition_demo_created' &&
        method === 'DELETE'
      ) {
        const index = compositions.findIndex(
          (record) => record.id === 'composition_demo_created',
        )
        if (index >= 0) compositions.splice(index, 1)
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(
        jsonResponse({ error: `unexpected request ${method} ${path}` }, 500),
      )
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

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 40 && !condition(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
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
  const tab = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === '体重',
  )
  await performAct(() => {
    tab?.click()
  })
  await waitFor(
    () =>
      container.querySelector('[data-day]') !== null ||
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

const findInput = (
  form: HTMLFormElement,
  labelText: string,
): HTMLInputElement | null =>
  Array.from(form.querySelectorAll('label'))
    .find((label) => label.querySelector('span')?.textContent === labelText)
    ?.querySelector('input') ?? null

const compositionForm = (container: HTMLElement): HTMLFormElement =>
  container.querySelectorAll<HTMLFormElement>('form').item(1)

const compositionRecordsOutput = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-day]')).map(
    (day) => ({
      date: day.querySelector('h3')?.textContent,
      weights: Array.from(
        day.querySelectorAll<HTMLElement>('[data-record-id]'),
      ).map((article) => article.querySelector('strong')?.textContent),
      compositions: Array.from(
        day.querySelectorAll<HTMLElement>('[data-composition-id]'),
      ).map((article) => ({
        device: article.querySelector('h4')?.textContent,
        values: Array.from(article.querySelectorAll('span')).map(
          (value) => value.textContent,
        ),
      })),
    }),
  )

const groupedPageOutput = (
  container: HTMLElement,
  requests: ReadonlyArray<RequestRecord>,
) => {
  const history = container.querySelector(
    '[aria-labelledby="body-weight-history-title"]',
  )

  return {
    records: compositionRecordsOutput(container),
    ranges: requests
      .filter((request) => request.method === 'GET')
      .filter(
        (request) =>
          request.path.startsWith('/api/body-weights?') ||
          (request.path.startsWith('/api/body-compositions?') &&
            request.path !== ALL_BODY_COMPOSITIONS_RANGE),
      )
      .map((request) => request.path),
    estimateNote: compositionForm(container).querySelector('p')?.textContent,
    listEstimateNote: Array.from(history?.querySelectorAll('p') ?? []).find(
      (paragraph) => paragraph.textContent === COMPOSITION_ESTIMATE_NOTE,
    )?.textContent,
  }
}

const emptyPageOutput = (container: HTMLElement) => ({
  days: compositionRecordsOutput(container),
  emptyMessage: Array.from(container.querySelectorAll('p')).find(
    (paragraph) => paragraph.textContent === 'この期間の記録はありません',
  )?.textContent,
})

const mutationsOutput = (
  requests: ReadonlyArray<RequestRecord>,
  method: string,
) =>
  requests
    .filter((request) => request.method === method)
    .map((request) => ({ path: request.path, body: request.body }))

const compositionDraftOutput = (container: HTMLElement) => {
  const form = compositionForm(container)
  return {
    title: form.querySelector('h2')?.textContent,
    date: findInput(form, '日付')?.value,
    time: findInput(form, '測定時刻 (任意)')?.value,
    device: findInput(form, '機器名')?.value,
    bodyFatPercent: findInput(form, '体脂肪率 (%)')?.value,
    muscleMassKg: findInput(form, '筋肉量 (kg)')?.value,
    skeletalMusclePercent: findInput(form, '骨格筋率 (%)')?.value,
  }
}

const latestDeviceRetryOutput = (
  container: HTMLElement,
  requests: ReadonlyArray<RequestRecord>,
) => ({
  errorVisible: container.textContent.includes('latest device lookup failed'),
  latestDeviceRequests: requests
    .filter((request) => request.path === ALL_BODY_COMPOSITIONS_RANGE)
    .map((request) => request.path),
  draft: compositionDraftOutput(container),
})

const createdCompositionOutput = (
  container: HTMLElement,
  requests: ReadonlyArray<RequestRecord>,
) => ({
  posts: mutationsOutput(requests, 'POST'),
  records: compositionRecordsOutput(container),
  draft: compositionDraftOutput(container),
})

const correctedCompositionOutput = (
  container: HTMLElement,
  requests: ReadonlyArray<RequestRecord>,
) => ({
  patches: mutationsOutput(requests, 'PATCH'),
  records: compositionRecordsOutput(container),
  draft: compositionDraftOutput(container),
})

const deletedCompositionOutput = (
  container: HTMLElement,
  requests: ReadonlyArray<RequestRecord>,
  deleteCountBeforeConfirm: number,
  dialogVisibleBeforeConfirm: boolean,
) => ({
  deleteCountBeforeConfirm,
  dialogVisibleBeforeConfirm,
  deletes: mutationsOutput(requests, 'DELETE'),
  records: compositionRecordsOutput(container),
  emptyMessage: Array.from(container.querySelectorAll('p')).find(
    (paragraph) => paragraph.textContent === 'この期間の記録はありません',
  )?.textContent,
  draft: compositionDraftOutput(container),
})

const compositionSaveErrorOutput = (
  container: HTMLElement,
  requests: ReadonlyArray<RequestRecord>,
) => ({
  posts: mutationsOutput(requests, 'POST'),
  error: Array.from(container.querySelectorAll('[role="alert"]')).map(
    (alert) => alert.textContent,
  ),
  draft: compositionDraftOutput(container),
})

const partialLoadOutput = (container: HTMLElement) => ({
  weightRecords: compositionRecordsOutput(container),
  compositionErrorVisible: container.textContent.includes(
    'composition service unavailable',
  ),
})

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

describe('HistoryPage body-composition tab content', () => {
  it('groups weight-only, composition-only, and combined days', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const weights: BodyWeight[] = [
      {
        id: 'weight_demo_only',
        date: '2026-07-03',
        measuredAt: null,
        weightKg: 63.4,
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-03T00:00:00.000Z',
      },
      {
        id: 'weight_demo_both',
        date: '2026-07-05',
        measuredAt: null,
        weightKg: 63.2,
        createdAt: '2026-07-05T00:00:00.000Z',
        updatedAt: '2026-07-05T00:00:00.000Z',
      },
    ]
    const compositions = [
      savedComposition({
        id: 'composition_demo_only',
        date: '2026-07-04',
        device: 'Example Scale Q',
        bodyFatPercent: 24.2,
      }),
      savedComposition({
        id: 'composition_demo_both',
        date: '2026-07-05',
        device: 'Example Scale Z',
        muscleMassKg: 48.6,
      }),
    ]
    const { container, root, queryClient, requests } = setupPage(
      weights,
      compositions,
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)
      await waitFor(
        () =>
          container.querySelectorAll('[data-day]').length === 3 &&
          bodyCompositionRequests(requests).length >= 1,
      )

      expect(groupedPageOutput(container, requests)).toEqual({
        records: [
          {
            date: '2026年7月5日',
            weights: ['63.2 kg'],
            compositions: [
              {
                device: 'Example Scale Z',
                values: ['体脂肪率 —', '筋肉量 48.6 kg', '骨格筋率 —'],
              },
            ],
          },
          {
            date: '2026年7月4日',
            weights: [],
            compositions: [
              {
                device: 'Example Scale Q',
                values: ['体脂肪率 24.2 %', '筋肉量 —', '骨格筋率 —'],
              },
            ],
          },
          {
            date: '2026年7月3日',
            weights: ['63.4 kg'],
            compositions: [],
          },
        ],
        ranges: [
          '/api/body-weights?from=2026-06-29&to=2026-07-05',
          '/api/body-compositions?from=2026-06-29&to=2026-07-05',
        ],
        estimateNote:
          '体組成計による推定値です。機器が違う値は比べられません。',
        listEstimateNote:
          '体組成計による推定値です。機器が違う値は比べられません。',
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('shows an empty state when neither API has a record in the period', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const { container, root, queryClient } = setupPage([], [])

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)

      expect(emptyPageOutput(container)).toEqual({
        days: [],
        emptyMessage: 'この期間の記録はありません',
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('retries the latest device lookup after a failed all-history request', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const compositions = [
      savedComposition({
        id: 'composition_demo_latest',
        date: '2026-06-20',
        device: 'Example Scale Z',
        bodyFatPercent: 23.4,
      }),
    ]
    const { container, root, queryClient, requests } = setupPage(
      [],
      compositions,
      undefined,
      undefined,
      'latest device lookup failed',
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)
      await waitFor(() =>
        container.textContent.includes('latest device lookup failed'),
      )
      const retryButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent === '再試行')
      await performAct(() => {
        retryButton?.click()
      })
      const deviceInput = findInput(compositionForm(container), '機器名')
      await waitFor(() => deviceInput?.value === 'Example Scale Z')

      expect(latestDeviceRetryOutput(container, requests)).toEqual({
        errorVisible: false,
        latestDeviceRequests: [
          ALL_BODY_COMPOSITIONS_RANGE,
          ALL_BODY_COMPOSITIONS_RANGE,
        ],
        draft: {
          title: '体組成を記録',
          date: '2026-07-05',
          time: '',
          device: 'Example Scale Z',
          bodyFatPercent: '',
          muscleMassKg: '',
          skeletalMusclePercent: '',
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('creates a measurement with the most recent device as the default', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const compositions = [
      savedComposition({
        id: 'composition_demo_latest',
        date: '2026-07-04',
        device: 'Example Scale Z',
        bodyFatPercent: 23.4,
      }),
    ]
    const { container, root, queryClient, requests } = setupPage(
      [],
      compositions,
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)
      const form = compositionForm(container)
      const timeInput = findInput(form, '測定時刻 (任意)')
      const bodyFatInput = findInput(form, '体脂肪率 (%)')
      const muscleMassInput = findInput(form, '筋肉量 (kg)')
      if (timeInput !== null) await setInputValue(timeInput, '08:15')
      if (bodyFatInput !== null) await setInputValue(bodyFatInput, '25.1')
      if (muscleMassInput !== null) await setInputValue(muscleMassInput, '50.2')
      await clickButton(form, 'button[type="submit"]')
      await waitFor(
        () =>
          container.querySelector(
            '[data-composition-id="composition_demo_created"]',
          ) !== null,
      )

      await waitFor(
        () => compositionDraftOutput(container).bodyFatPercent === '',
      )

      expect(createdCompositionOutput(container, requests)).toEqual({
        posts: [
          {
            path: '/api/body-compositions',
            body: {
              date: '2026-07-05',
              measuredAt: '2026-07-05T08:15:00+09:00',
              device: 'Example Scale Z',
              bodyFatPercent: 25.1,
              muscleMassKg: 50.2,
            },
          },
        ],
        records: [
          {
            date: '2026年7月5日',
            weights: [],
            compositions: [
              {
                device: 'Example Scale Z',
                values: ['体脂肪率 25.1 %', '筋肉量 50.2 kg', '骨格筋率 —'],
              },
            ],
          },
          {
            date: '2026年7月4日',
            weights: [],
            compositions: [
              {
                device: 'Example Scale Z',
                values: ['体脂肪率 23.4 %', '筋肉量 —', '骨格筋率 —'],
              },
            ],
          },
        ],
        draft: {
          title: '体組成を記録',
          date: '2026-07-05',
          time: '',
          device: 'Example Scale Z',
          bodyFatPercent: '',
          muscleMassKg: '',
          skeletalMusclePercent: '',
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('keeps the latest device when saving from an older history period', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const compositions = [
      savedComposition({
        id: 'composition_demo_latest',
        date: '2026-06-20',
        device: 'Example Scale Z',
        bodyFatPercent: 23.4,
      }),
      savedComposition({
        id: 'composition_demo_older',
        date: '2026-06-10',
        device: 'Example Scale Q',
        bodyFatPercent: 24.2,
      }),
    ]
    const { container, root, queryClient, requests } = setupPage(
      [],
      compositions,
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)
      const form = compositionForm(container)
      const deviceInput = findInput(form, '機器名')
      await waitFor(() => deviceInput?.value === 'Example Scale Z')

      for (let period = 0; period < 3; period += 1) {
        await clickButton(container, 'button[aria-label="前の期間"]')
      }
      await waitFor(
        () =>
          container.querySelector(
            '[data-composition-id="composition_demo_older"]',
          ) !== null,
      )

      const bodyFatInput = findInput(form, '体脂肪率 (%)')
      if (bodyFatInput !== null) await setInputValue(bodyFatInput, '25.1')
      await clickButton(form, 'button[type="submit"]')
      await waitFor(
        () => compositionDraftOutput(container).bodyFatPercent === '',
      )

      expect(createdCompositionOutput(container, requests)).toEqual({
        posts: [
          {
            path: '/api/body-compositions',
            body: {
              date: '2026-07-05',
              device: 'Example Scale Z',
              bodyFatPercent: 25.1,
            },
          },
        ],
        records: [
          {
            date: '2026年6月10日',
            weights: [],
            compositions: [
              {
                device: 'Example Scale Q',
                values: ['体脂肪率 24.2 %', '筋肉量 —', '骨格筋率 —'],
              },
            ],
          },
        ],
        draft: {
          title: '体組成を記録',
          date: '2026-07-05',
          time: '',
          device: 'Example Scale Z',
          bodyFatPercent: '',
          muscleMassKg: '',
          skeletalMusclePercent: '',
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('corrects fields with null and defaults the next entry to the updated device', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const compositions = [
      savedComposition({
        id: 'composition_demo_created',
        date: '2026-07-05',
        measuredAt: '2026-07-05T00:20:00.000Z',
        device: 'Example Scale Z',
        bodyFatPercent: 25.1,
        muscleMassKg: 50.2,
      }),
    ]
    const { container, root, queryClient, requests } = setupPage(
      [],
      compositions,
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)
      await clickButton(
        container,
        'button[aria-label="体組成を訂正 Example Scale Z 2026年7月5日"]',
      )
      const form = compositionForm(container)
      const deviceInput = findInput(form, '機器名')
      const bodyFatInput = findInput(form, '体脂肪率 (%)')
      if (deviceInput !== null)
        await setInputValue(deviceInput, 'Example Scale Y')
      if (bodyFatInput !== null) await setInputValue(bodyFatInput, '')
      await clickButton(form, 'button[type="submit"]')
      await waitFor(
        () =>
          compositionDraftOutput(container).title === '体組成を記録' &&
          compositionDraftOutput(container).device === 'Example Scale Y',
      )

      expect(correctedCompositionOutput(container, requests)).toEqual({
        patches: [
          {
            path: '/api/body-compositions/composition_demo_created',
            body: {
              date: '2026-07-05',
              device: 'Example Scale Y',
              bodyFatPercent: null,
              muscleMassKg: 50.2,
              skeletalMusclePercent: null,
            },
          },
        ],
        records: [
          {
            date: '2026年7月5日',
            weights: [],
            compositions: [
              {
                device: 'Example Scale Y',
                values: ['体脂肪率 —', '筋肉量 50.2 kg', '骨格筋率 —'],
              },
            ],
          },
        ],
        draft: {
          title: '体組成を記録',
          date: '2026-07-05',
          time: '',
          device: 'Example Scale Y',
          bodyFatPercent: '',
          muscleMassKg: '',
          skeletalMusclePercent: '',
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('deletes a composition record only after confirmation', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const compositions = [
      savedComposition({
        id: 'composition_demo_created',
        date: '2026-07-05',
        device: 'Example Scale Z',
        bodyFatPercent: 24.5,
      }),
    ]
    const { container, root, queryClient, requests } = setupPage(
      [],
      compositions,
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)
      await clickButton(
        container,
        'button[aria-label="体組成を削除 Example Scale Z 2026年7月5日"]',
      )
      const dialogVisibleBeforeConfirm =
        container.querySelector('[role="alertdialog"]') !== null
      const deleteCountBeforeConfirm = mutationsOutput(
        requests,
        'DELETE',
      ).length
      await clickButton(container, 'button[aria-label="体組成の記録を削除"]')
      await waitFor(() =>
        Array.from(container.querySelectorAll('p')).some(
          (paragraph) => paragraph.textContent === 'この期間の記録はありません',
        ),
      )

      expect(
        deletedCompositionOutput(
          container,
          requests,
          deleteCountBeforeConfirm,
          dialogVisibleBeforeConfirm,
        ),
      ).toEqual({
        deleteCountBeforeConfirm: 0,
        dialogVisibleBeforeConfirm: true,
        deletes: [
          {
            path: '/api/body-compositions/composition_demo_created',
            body: null,
          },
        ],
        records: [],
        emptyMessage: 'この期間の記録はありません',
        draft: {
          title: '体組成を記録',
          date: '2026-07-05',
          time: '',
          device: 'Example Scale Z',
          bodyFatPercent: '',
          muscleMassKg: '',
          skeletalMusclePercent: '',
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('shows the API error and keeps input values after a rejected create', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const { container, root, queryClient, requests } = setupPage(
      [],
      [],
      'invalid composition measurement',
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)
      const form = compositionForm(container)
      const timeInput = findInput(form, '測定時刻 (任意)')
      const deviceInput = findInput(form, '機器名')
      const bodyFatInput = findInput(form, '体脂肪率 (%)')
      const muscleMassInput = findInput(form, '筋肉量 (kg)')
      const skeletalMuscleInput = findInput(form, '骨格筋率 (%)')
      if (timeInput !== null) await setInputValue(timeInput, '08:15')
      if (deviceInput !== null)
        await setInputValue(deviceInput, 'Example Scale Z')
      if (bodyFatInput !== null) await setInputValue(bodyFatInput, '25.1')
      if (muscleMassInput !== null) await setInputValue(muscleMassInput, '50.2')
      if (skeletalMuscleInput !== null)
        await setInputValue(skeletalMuscleInput, '36.7')
      await clickButton(form, 'button[type="submit"]')
      await waitFor(() =>
        Array.from(container.querySelectorAll('[role="alert"]')).some(
          (alert) => alert.textContent === 'invalid composition measurement',
        ),
      )

      expect(compositionSaveErrorOutput(container, requests)).toEqual({
        posts: [
          {
            path: '/api/body-compositions',
            body: {
              date: '2026-07-05',
              measuredAt: '2026-07-05T08:15:00+09:00',
              device: 'Example Scale Z',
              bodyFatPercent: 25.1,
              muscleMassKg: 50.2,
              skeletalMusclePercent: 36.7,
            },
          },
        ],
        error: ['invalid composition measurement'],
        draft: {
          title: '体組成を記録',
          date: '2026-07-05',
          time: '08:15',
          device: 'Example Scale Z',
          bodyFatPercent: '25.1',
          muscleMassKg: '50.2',
          skeletalMusclePercent: '36.7',
        },
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })

  it('keeps weight history visible when the composition API fails', async () => {
    vi.spyOn(Temporal.Now, 'plainDateISO').mockReturnValue(
      Temporal.PlainDate.from('2026-07-05'),
    )
    const weights: BodyWeight[] = [
      {
        id: 'weight_demo_visible',
        date: '2026-07-05',
        measuredAt: null,
        weightKg: 63.4,
        createdAt: '2026-07-05T00:00:00.000Z',
        updatedAt: '2026-07-05T00:00:00.000Z',
      },
    ]
    const { container, root, queryClient } = setupPage(
      weights,
      [],
      undefined,
      'composition service unavailable',
    )

    try {
      await performAct(() => {
        renderPage(root, queryClient)
      })
      await openBodyWeightTab(container)
      await waitFor(
        () =>
          compositionRecordsOutput(container)[0]?.weights.length === 1 &&
          container.textContent.includes('composition service unavailable'),
      )

      expect(partialLoadOutput(container)).toEqual({
        weightRecords: [
          {
            date: '2026年7月5日',
            weights: ['63.4 kg'],
            compositions: [],
          },
        ],
        compositionErrorVisible: true,
      })
    } finally {
      await cleanupPage(container, root, queryClient)
    }
  })
})
