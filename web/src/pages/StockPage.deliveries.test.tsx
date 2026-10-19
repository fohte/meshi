import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StockStatus } from '#api/stock'
import { StockPage } from '#pages/StockPage'
import { performAct, setInputValue } from '#test/test-helpers'

const STOCK_STATUS: StockStatus = {
  stockItems: [
    {
      foodMasterId: 'food_example_oats',
      foodName: '架空オーツ',
      storageLocation: null,
      eatWithinDays: null,
      totalQuantity: 0,
      lots: [],
      storageLocationId: null,
    },
  ],
  plannedDeliveries: [],
  capacityWarnings: [],
  eatByWarnings: [],
  priorityLots: [],
}

const DELIVERY = {
  id: 'delivery_example',
  sourceRef: 'order_example_57',
  status: 'planned',
  expectedDate: '2026-12-02',
  receivedDate: null,
  changeDeadline: null,
  items: [
    {
      foodMasterId: 'food_example_oats',
      foodName: '架空オーツ',
      quantity: 3.5,
    },
  ],
}

const UNNUMBERED_DELIVERY = {
  ...DELIVERY,
  sourceRef: null,
  expectedDate: '2026-12-03',
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

interface FetchRecord {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

interface PageSetup {
  readonly container: HTMLDivElement
  readonly root: Root
  readonly requests: Array<FetchRecord>
}

const mountedRoots: Root[] = []

const requestPath = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

const parseRequestBody = (body: string): unknown => JSON.parse(body) as unknown

const setupPage = (
  handler: (record: FetchRecord) => Response | Promise<Response>,
): PageSetup => {
  const requests: Array<FetchRecord> = []
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const rawBody = init?.body
      const record = {
        path: requestPath(input),
        method: init?.method ?? 'GET',
        body: typeof rawBody === 'string' ? parseRequestBody(rawBody) : null,
      }
      requests.push(record)
      return handler(record)
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  })
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <StockPage />
      </QueryClientProvider>,
    )
  })

  return { container, root, requests }
}

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 50 && !condition(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

const textContent = (element: Element | null): string | null =>
  element?.textContent.replace(/\s+/g, ' ').trim() ?? null

const clickButton = async (
  container: HTMLElement,
  label: string,
): Promise<void> =>
  performAct(() => {
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === label)
      ?.click()
  })

const setSelectValue = async (
  select: HTMLSelectElement,
  value: string,
): Promise<void> =>
  performAct(() => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    )?.set?.bind(select)
    setValue?.(value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })

const normalizeRequests = (
  requests: ReadonlyArray<FetchRecord>,
): ReadonlyArray<FetchRecord> =>
  requests.map((request) =>
    request.body !== null &&
    typeof request.body === 'object' &&
    'receivedDate' in request.body
      ? {
          ...request,
          body: { ...request.body, receivedDate: '<date>' },
        }
      : request,
  )

const readRegistrationOutput = (setup: PageSetup, section: Element | null) => ({
  requests: setup.requests,
  plannedDeliveries: Array.from(section?.querySelectorAll('article') ?? []).map(
    (article) => ({
      title: textContent(article.querySelector('h3')),
      actions: Array.from(article.querySelectorAll('button')).map((button) =>
        button.textContent.trim(),
      ),
    }),
  ),
})

const readConflictOutput = (
  setup: PageSetup,
  section: Element | null,
  container: HTMLElement,
) => ({
  requests: normalizeRequests(setup.requests),
  plannedDeliveryCount: section?.querySelectorAll('article').length ?? 0,
  error: textContent(container.querySelector('[role="alert"]')),
  confirmation: textContent(
    container.querySelector('#stock-delivery-confirmation-title'),
  ),
})

const readUnnumberedOutput = (
  actions: ReadonlyArray<string>,
  container: HTMLElement,
) => ({
  actions,
  confirmation: textContent(
    container.querySelector('#stock-delivery-confirmation-title'),
  ),
  orderNumber: textContent(container.querySelector('dl dd')),
})

afterEach(async () => {
  await performAct(() => {
    for (const root of mountedRoots) root.unmount()
  })
  mountedRoots.length = 0
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('StockPage delivery management', () => {
  it('submits an order once and reloads the stock status after success', async () => {
    let currentStatus = STOCK_STATUS
    const setup = setupPage((request) => {
      if (request.path === '/api/stock/deliveries') {
        currentStatus = {
          ...STOCK_STATUS,
          plannedDeliveries: [
            {
              id: DELIVERY.id,
              sourceRef: DELIVERY.sourceRef,
              expectedDate: DELIVERY.expectedDate,
              changeDeadline: DELIVERY.changeDeadline,
              items: DELIVERY.items,
            },
          ],
        }
        return jsonResponse(DELIVERY)
      }
      return jsonResponse(currentStatus)
    })
    await waitFor(() => setup.container.textContent.includes('予定を登録'))
    await clickButton(setup.container, '予定を登録')

    const sourceRef = setup.container.querySelector<HTMLInputElement>(
      '#stock-delivery-source-ref',
    )
    const expectedDate = setup.container.querySelector<HTMLInputElement>(
      '#stock-delivery-expected-date',
    )
    const itemSelect = setup.container.querySelector('select')
    if (sourceRef !== null) await setInputValue(sourceRef, 'order_example_57')
    if (expectedDate !== null) await setInputValue(expectedDate, '2026-12-02')
    if (itemSelect !== null) {
      await setSelectValue(itemSelect, 'food_example_oats')
    }
    const quantity = setup.container.querySelector<HTMLInputElement>(
      'input[type="number"]',
    )
    if (quantity !== null) await setInputValue(quantity, '3.5')
    await performAct(() => {
      const form = setup.container.querySelector('form')
      const submit = () =>
        form?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        )
      submit()
      submit()
    })
    await waitFor(() =>
      setup.container.textContent.includes('注文番号 order_example_57'),
    )

    const plannedDeliverySection = setup.container.querySelector(
      'section[aria-labelledby="planned-deliveries-title"]',
    )
    expect(readRegistrationOutput(setup, plannedDeliverySection)).toEqual({
      requests: [
        { path: '/api/stock', method: 'GET', body: null },
        {
          path: '/api/stock/deliveries',
          method: 'POST',
          body: {
            sourceRef: 'order_example_57',
            status: 'planned',
            expectedDate: '2026-12-02',
            changeDeadline: null,
            items: [{ foodMasterId: 'food_example_oats', quantity: 3.5 }],
          },
        },
        { path: '/api/stock', method: 'GET', body: null },
      ],
      plannedDeliveries: [
        {
          title: '注文番号 order_example_57',
          actions: ['受領', '変更', '予定を取り消す'],
        },
      ],
    })
  })

  it('reloads stock after a 409 and keeps the error visible', async () => {
    let stockStatus: StockStatus = {
      ...STOCK_STATUS,
      plannedDeliveries: [UNNUMBERED_DELIVERY],
    }
    const setup = setupPage((request) => {
      if (request.path.endsWith('/receive')) {
        stockStatus = STOCK_STATUS
        return jsonResponse({ error: 'delivery is no longer planned' }, 409)
      }
      return jsonResponse(stockStatus)
    })
    await waitFor(() => setup.container.textContent.includes('架空オーツ'))
    await clickButton(setup.container, '受領')
    await clickButton(setup.container, '受領内容を確認')
    await clickButton(setup.container, '受領を確定')
    await waitFor(() =>
      setup.container.textContent.includes('delivery is no longer planned'),
    )

    const plannedDeliverySection = setup.container.querySelector(
      'section[aria-labelledby="planned-deliveries-title"]',
    )
    expect(
      readConflictOutput(setup, plannedDeliverySection, setup.container),
    ).toEqual({
      requests: [
        { path: '/api/stock', method: 'GET', body: null },
        {
          path: '/api/stock/deliveries/delivery_example/receive',
          method: 'POST',
          body: {
            receivedDate: '<date>',
            items: [{ foodMasterId: 'food_example_oats', quantity: 3.5 }],
          },
        },
        { path: '/api/stock', method: 'GET', body: null },
      ],
      plannedDeliveryCount: 0,
      error: 'delivery is no longer planned',
      confirmation: '受領内容',
    })
  })

  it('shows only the receive action for a delivery without an order number', async () => {
    const setup = setupPage(() =>
      jsonResponse({
        ...STOCK_STATUS,
        plannedDeliveries: [UNNUMBERED_DELIVERY],
      }),
    )
    await waitFor(() => setup.container.textContent.includes('注文番号 不明'))

    const plannedDeliverySection = setup.container.querySelector(
      'section[aria-labelledby="planned-deliveries-title"]',
    )
    const actions = Array.from(
      plannedDeliverySection?.querySelectorAll('article button') ?? [],
    ).map((button) => button.textContent.trim())
    await clickButton(setup.container, '受領')
    await clickButton(setup.container, '受領内容を確認')

    expect(readUnnumberedOutput(actions, setup.container)).toEqual({
      actions: ['受領'],
      confirmation: '受領内容',
      orderNumber: '注文番号の登録なし',
    })
  })
})
