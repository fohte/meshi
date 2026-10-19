import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StockStatus } from '#api/stock'
import { StockPage } from '#pages/StockPage'
import { performAct } from '#test/test-helpers'

const EMPTY_STOCK_STATUS: StockStatus = {
  stockItems: [],
  plannedDeliveries: [],
  capacityWarnings: [],
  eatByWarnings: [],
  priorityLots: [],
}

const STALE_STOCK_STATUS: StockStatus = {
  stockItems: [
    {
      foodMasterId: 'food_example_spice',
      foodName: '架空香辛料',
      storageLocation: { name: '乾物棚', capacity: null },
      eatWithinDays: null,
      totalQuantity: 0.75,
      lots: [],
      storageLocationId: 'location_example_dry',
    },
  ],
  plannedDeliveries: [],
  capacityWarnings: [],
  eatByWarnings: [],
  priorityLots: [],
}

const STOCK_STATUS: StockStatus = {
  stockItems: [
    {
      foodMasterId: 'food_example_rice',
      foodName: '架空米',
      storageLocation: { name: '冷蔵棚', capacity: null },
      eatWithinDays: 2,
      totalQuantity: 0.5,
      lots: [
        {
          id: 'lot_example_rice',
          quantity: 1,
          remainingQuantity: 0.5,
          receivedDate: null,
          bestBefore: '2026-11-05',
          eatBy: null,
        },
      ],
      storageLocationId: 'location_example_cold',
    },
    {
      foodMasterId: 'food_example_stew',
      foodName: '架空煮込み',
      storageLocation: null,
      eatWithinDays: null,
      totalQuantity: 0,
      lots: [],
      storageLocationId: null,
    },
  ],
  plannedDeliveries: [
    {
      id: 'delivery_example',
      sourceRef: null,
      expectedDate: '2026-11-06',
      changeDeadline: null,
      items: [
        {
          foodMasterId: 'food_example_rice',
          foodName: '架空米',
          quantity: 1.5,
        },
      ],
    },
  ],
  capacityWarnings: [
    {
      id: 'capacity_warning_example',
      storageLocationId: 'location_example_cold',
      storageLocationName: '冷蔵棚',
      expectedDate: '2026-11-06',
      deliveries: [{ deliveryId: 'delivery_example', changeDeadline: null }],
      projectedQuantity: 3.5,
      capacity: 3,
      excessQuantity: 0.5,
    },
  ],
  eatByWarnings: [
    {
      id: 'eat_by_warning_example',
      riskType: 'deadline_passed',
      stockLotId: 'lot_example_rice',
      foodMasterId: 'food_example_rice',
      foodName: '架空米',
      targetDate: '2026-10-01',
      targetDateType: 'best_before',
      remainingQuantity: 0.5,
      quantityUsedForRate: null,
      daysUntilTarget: null,
      requiredDailyConsumption: null,
      actualDailyConsumption: 0.25,
    },
    {
      id: 'eat_by_warning_example_two',
      riskType: 'consumption_rate_below_required',
      stockLotId: 'lot_example_stew',
      foodMasterId: 'food_example_stew',
      foodName: '架空煮込み',
      targetDate: '2026-11-07',
      targetDateType: 'eat_by',
      remainingQuantity: 1.25,
      quantityUsedForRate: 0.25,
      daysUntilTarget: 5,
      requiredDailyConsumption: 0.25,
      actualDailyConsumption: 0.05,
    },
  ],
  priorityLots: [
    {
      foodMasterId: 'food_example_rice',
      foodName: '架空米',
      stockLotId: 'lot_example_rice',
      remainingQuantity: 0.5,
      targetDate: null,
      reasons: ['deadline_passed', 'oldest_received'],
    },
  ],
}

const CAPACITY_WARNING_STATUS: StockStatus = {
  stockItems: [],
  plannedDeliveries: [
    {
      id: 'delivery_example_first',
      sourceRef: 'order_example_first',
      expectedDate: '2026-11-09',
      changeDeadline: '2026-11-06',
      items: [
        {
          foodMasterId: 'food_example_tea',
          foodName: '架空茶葉',
          quantity: 2,
        },
      ],
    },
    {
      id: 'delivery_example_second',
      sourceRef: 'order_example_second',
      expectedDate: '2026-11-09',
      changeDeadline: null,
      items: [
        {
          foodMasterId: 'food_example_spice',
          foodName: '架空香辛料',
          quantity: 1.5,
        },
      ],
    },
  ],
  capacityWarnings: [
    {
      id: 'capacity_warning_example',
      storageLocationId: 'location_example_pantry',
      storageLocationName: '架空食品庫',
      expectedDate: '2026-11-09',
      deliveries: [
        {
          deliveryId: 'delivery_example_second',
          changeDeadline: null,
        },
        {
          deliveryId: 'delivery_example_first',
          changeDeadline: '2026-11-06',
        },
      ],
      projectedQuantity: 6,
      capacity: 4,
      excessQuantity: 2,
    },
  ],
  eatByWarnings: [],
  priorityLots: [],
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const mountedRoots: Root[] = []

const setupPage = (
  fetchHandler: () => Promise<Response>,
): {
  readonly container: HTMLDivElement
  readonly root: Root
  readonly queryClient: QueryClient
} => {
  vi.stubGlobal('fetch', vi.fn(fetchHandler))

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  return { container, root, queryClient }
}

const renderPage = (root: Root, queryClient: QueryClient): Promise<void> =>
  performAct(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <StockPage />
      </QueryClientProvider>,
    )
  })

const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 40 && !condition(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
}

const textContent = (element: Element | null): string | null =>
  element?.textContent.replace(/\s+/g, ' ').trim() ?? null

const readPageState = (container: HTMLElement) => ({
  headings: Array.from(container.querySelectorAll('h1, h2, h3')).map(
    textContent,
  ),
  paragraphs: Array.from(container.querySelectorAll('p')).map(textContent),
  fields: Array.from(container.querySelectorAll('dl > div')).map((field) => ({
    label: textContent(field.querySelector('dt')),
    value: textContent(field.querySelector('dd')),
  })),
  summaries: Array.from(container.querySelectorAll('summary')).map(textContent),
  listItems: Array.from(container.querySelectorAll('ul > li')).map(textContent),
  alerts: Array.from(container.querySelectorAll('[role="alert"]')).map(
    textContent,
  ),
  refreshDisabled: refreshButton(container)?.disabled ?? null,
  refreshStatus: textContent(container.querySelector('[role="status"]')),
  retryButtons: Array.from(container.querySelectorAll('button')).filter(
    (button) => button.textContent.trim() === '再試行',
  ).length,
})

const readPageOutput = (
  requests: ReadonlyArray<string>,
  container: HTMLElement,
) => ({
  requests,
  page: readPageState(container),
})

const readCapacityWarningOutput = (container: HTMLElement) => {
  const section = container.querySelector(
    'section[aria-labelledby="capacity-warnings-title"]',
  )

  return {
    heading: textContent(section?.querySelector('h2') ?? null),
    emptyMessage: textContent(section?.querySelector('h2 + p') ?? null),
    warnings: Array.from(section?.querySelectorAll('article') ?? []).map(
      (warning) => ({
        heading: textContent(warning.querySelector('h3')),
        date: textContent(warning.querySelector('header p')),
        summary: textContent(warning.querySelector('header + p')),
        deliveries: Array.from(warning.querySelectorAll('ul > li')).map(
          (delivery) => ({
            heading: textContent(delivery.querySelector('h4')),
            fields: Array.from(delivery.querySelectorAll('dl > div')).map(
              (field) => ({
                label: textContent(field.querySelector('dt')),
                value: textContent(field.querySelector('dd')),
              }),
            ),
          }),
        ),
      }),
    ),
  }
}

const readCapacityWarningPageOutput = (
  requests: ReadonlyArray<string>,
  container: HTMLElement,
) => ({
  requests,
  capacityWarning: readCapacityWarningOutput(container),
})

const readRefreshRecoveryOutput = (
  requests: ReadonlyArray<string>,
  afterRefreshFailure: ReturnType<typeof readPageState>,
  container: HTMLElement,
) => ({
  requests,
  afterRefreshFailure,
  afterRetry: readPageState(container),
})

const EMPTY_PAGE_STATE = {
  headings: [
    '# 在庫',
    '在庫',
    '入荷予定',
    '容量超過',
    '食べ切り警告',
    '先に食べたい入荷分',
  ],
  paragraphs: [
    '数量は食品登録時の単位で表示しています。',
    '在庫対象はありません。',
    '入荷予定はありません。',
    '容量超過の警告はありません。',
    '食べ切りの警告はありません。',
    '先に食べたい入荷分はありません。',
  ],
  fields: [],
  summaries: [],
  listItems: [],
  alerts: [],
  refreshDisabled: false,
  refreshStatus: null,
  retryButtons: 0,
}

const STALE_ERROR_PAGE_STATE = {
  headings: [
    '# 在庫',
    '在庫',
    '架空香辛料',
    '入荷予定',
    '容量超過',
    '食べ切り警告',
    '先に食べたい入荷分',
  ],
  paragraphs: [
    '数量は食品登録時の単位で表示しています。',
    '更新に失敗しました。表示中の在庫は最後に取得した内容です。',
    '残数 0.75',
    '入荷分はありません。',
    '入荷予定はありません。',
    '容量超過の警告はありません。',
    '食べ切りの警告はありません。',
    '先に食べたい入荷分はありません。',
  ],
  fields: [
    { label: '保存場所', value: '乾物棚' },
    { label: '容量', value: '未設定' },
    { label: '食べ切り目安', value: '未設定' },
  ],
  summaries: [],
  listItems: [],
  alerts: ['更新に失敗しました。表示中の在庫は最後に取得した内容です。再試行'],
  refreshDisabled: false,
  refreshStatus: null,
  retryButtons: 1,
}

const refreshButton = (container: HTMLElement): HTMLButtonElement | null =>
  Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent.trim() === '更新',
  ) ?? null

afterEach(async () => {
  await performAct(() => {
    for (const root of mountedRoots) root.unmount()
  })
  mountedRoots.length = 0
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('StockPage', () => {
  it('shows the complete stock status with fractions and unknown values', async () => {
    const requests: string[] = []
    const { container, root, queryClient } = setupPage(() => {
      requests.push('/api/stock')
      return Promise.resolve(jsonResponse(STOCK_STATUS))
    })
    await renderPage(root, queryClient)
    await waitFor(() => container.textContent.includes('架空米'))
    await performAct(() => {
      container.querySelector('summary')?.click()
    })

    expect(readPageOutput(requests, container)).toEqual({
      requests: ['/api/stock'],
      page: {
        headings: [
          '# 在庫',
          '在庫',
          '架空米',
          '架空煮込み',
          '入荷予定',
          '注文番号 不明',
          '容量超過',
          '冷蔵棚',
          '食べ切り警告',
          '架空米',
          '架空煮込み',
          '先に食べたい入荷分',
          '架空米',
        ],
        paragraphs: [
          '数量は食品登録時の単位で表示しています。',
          '残数 0.5',
          '残数 0.5',
          '残数 0',
          '入荷分はありません。',
          '2026-11-06',
          '予測 3.5 / 容量 3 / 超過 0.5',
          '期限超過',
          '賞味期限 2026-10-01 / 残数 0.5',
          '消費ペース不足',
          '食べ切り目標日 2026-11-07 / 残数 1.25',
          '残数 0.5',
          '対象日 不明',
        ],
        fields: [
          { label: '保存場所', value: '冷蔵棚' },
          { label: '容量', value: '未設定' },
          { label: '食べ切り目安', value: '2 日' },
          { label: '受領日', value: '不明' },
          { label: '賞味期限', value: '2026-11-05' },
          { label: '食べ切り目標日', value: '不明' },
          { label: '保存場所', value: '未設定' },
          { label: '容量', value: '未設定' },
          { label: '食べ切り目安', value: '未設定' },
          { label: '入荷予定日', value: '2026-11-06' },
          { label: '変更締切', value: '不明' },
          { label: '入荷予定日', value: '2026-11-06' },
          { label: '変更締切', value: '不明' },
          { label: '消費ペース算定量', value: '不明' },
          { label: '期限まで', value: '不明' },
          { label: '必要な消費量', value: '不明' },
          { label: '実際の消費量', value: '0.25 / 日' },
          { label: '消費ペース算定量', value: '0.25' },
          { label: '期限まで', value: '5 日' },
          { label: '必要な消費量', value: '0.25 / 日' },
          { label: '実際の消費量', value: '0.05 / 日' },
        ],
        summaries: ['入荷分 1 件'],
        listItems: [
          '残数 0.5受領日不明賞味期限2026-11-05食べ切り目標日不明',
          '架空米数量 1.5',
          '注文番号 不明入荷予定日2026-11-06変更締切不明',
          '期限超過',
          '古い入荷分',
        ],
        alerts: [],
        refreshDisabled: false,
        refreshStatus: null,
        retryButtons: 0,
      },
    })
  })

  it('matches each capacity warning to its delivery and change deadline', async () => {
    const requests: string[] = []
    const { container, root, queryClient } = setupPage(() => {
      requests.push('/api/stock')
      return Promise.resolve(jsonResponse(CAPACITY_WARNING_STATUS))
    })
    await renderPage(root, queryClient)
    await waitFor(
      () =>
        readCapacityWarningOutput(container).warnings[0]?.deliveries.length ===
        2,
    )

    expect(readCapacityWarningPageOutput(requests, container)).toEqual({
      requests: ['/api/stock'],
      capacityWarning: {
        heading: '容量超過',
        emptyMessage: null,
        warnings: [
          {
            heading: '架空食品庫',
            date: '2026-11-09',
            summary: '予測 6 / 容量 4 / 超過 2',
            deliveries: [
              {
                heading: '注文番号 order_example_second',
                fields: [
                  { label: '入荷予定日', value: '2026-11-09' },
                  { label: '変更締切', value: '不明' },
                ],
              },
              {
                heading: '注文番号 order_example_first',
                fields: [
                  { label: '入荷予定日', value: '2026-11-09' },
                  { label: '変更締切', value: '2026-11-06' },
                ],
              },
            ],
          },
        ],
      },
    })
  })

  it('shows an error state and retries the failed request', async () => {
    const requests: string[] = []
    const { container, root, queryClient } = setupPage(() => {
      requests.push('/api/stock')
      return requests.length === 1
        ? Promise.resolve(jsonResponse({ error: 'unavailable' }, 500))
        : Promise.resolve(jsonResponse(EMPTY_STOCK_STATUS))
    })
    await renderPage(root, queryClient)
    await waitFor(() => container.textContent.includes('再試行'))
    await performAct(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent.trim() === '再試行')
        ?.click()
    })
    await waitFor(() =>
      container.textContent.includes('在庫対象はありません。'),
    )

    expect(readPageOutput(requests, container)).toEqual({
      requests: ['/api/stock', '/api/stock'],
      page: EMPTY_PAGE_STATE,
    })
  })

  it('keeps cached stock visible and retries after a refresh failure', async () => {
    const requests: string[] = []
    const { container, root, queryClient } = setupPage(() => {
      requests.push('/api/stock')
      if (requests.length === 1) {
        return Promise.resolve(jsonResponse(STALE_STOCK_STATUS))
      }
      if (requests.length === 2) {
        return Promise.resolve(jsonResponse({ error: 'unavailable' }, 500))
      }
      return Promise.resolve(jsonResponse(EMPTY_STOCK_STATUS))
    })
    await renderPage(root, queryClient)
    await waitFor(() => container.textContent.includes('架空香辛料'))
    await performAct(() => {
      refreshButton(container)?.click()
    })
    await waitFor(() => container.textContent.includes('更新に失敗しました。'))
    const afterRefreshFailure = readPageState(container)
    await performAct(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent.trim() === '再試行')
        ?.click()
    })
    await waitFor(
      () =>
        requests.length === 3 &&
        container.textContent.includes('在庫対象はありません。'),
    )

    expect(
      readRefreshRecoveryOutput(requests, afterRefreshFailure, container),
    ).toEqual({
      requests: ['/api/stock', '/api/stock', '/api/stock'],
      afterRefreshFailure: STALE_ERROR_PAGE_STATE,
      afterRetry: EMPTY_PAGE_STATE,
    })
  })

  it('disables refresh while the request is pending', async () => {
    const requests: string[] = []
    let resolveRefresh: (response: Response) => void = () => undefined
    const { container, root, queryClient } = setupPage(() => {
      requests.push('/api/stock')
      return requests.length === 2
        ? new Promise<Response>((resolve) => {
            resolveRefresh = resolve
          })
        : Promise.resolve(jsonResponse(EMPTY_STOCK_STATUS))
    })
    await renderPage(root, queryClient)
    await waitFor(() =>
      container.textContent.includes('在庫対象はありません。'),
    )
    await performAct(() => {
      refreshButton(container)?.click()
    })
    await waitFor(() => requests.length === 2)
    await performAct(() => {
      refreshButton(container)?.click()
    })

    expect(readPageOutput(requests, container)).toEqual({
      requests: ['/api/stock', '/api/stock'],
      page: {
        ...EMPTY_PAGE_STATE,
        refreshDisabled: true,
        refreshStatus: '更新中…',
      },
    })

    resolveRefresh(jsonResponse(EMPTY_STOCK_STATUS))
    await waitFor(() => refreshButton(container)?.disabled === false)
  })

  it('fetches fresh stock again when the page is revisited', async () => {
    const requests: string[] = []
    const { container, root, queryClient } = setupPage(() => {
      requests.push('/api/stock')
      return Promise.resolve(
        jsonResponse(
          requests.length === 1 ? EMPTY_STOCK_STATUS : STALE_STOCK_STATUS,
        ),
      )
    })
    await renderPage(root, queryClient)
    await waitFor(() =>
      container.textContent.includes('在庫対象はありません。'),
    )
    await performAct(() => {
      root.render(null)
    })
    await renderPage(root, queryClient)
    await waitFor(() => container.textContent.includes('架空香辛料'))

    expect(readPageOutput(requests, container)).toEqual({
      requests: ['/api/stock', '/api/stock'],
      page: {
        ...STALE_ERROR_PAGE_STATE,
        paragraphs: [
          '数量は食品登録時の単位で表示しています。',
          '残数 0.75',
          '入荷分はありません。',
          '入荷予定はありません。',
          '容量超過の警告はありません。',
          '食べ切りの警告はありません。',
          '先に食べたい入荷分はありません。',
        ],
        alerts: [],
        retryButtons: 0,
      },
    })
  })
})
