import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TodayPage } from '#pages/TodayPage'

vi.mock('#pages/DayDetailView', () => ({
  DayDetailView: () => <div data-testid="day-detail">today detail</div>,
}))

const outlook = {
  asOf: '2093-04-12',
  points: [{ date: '2093-04-12', weightKg: 63.4 }],
  latestWeightKg: 63.4,
  goalWeightKg: 60,
  trend: {
    slopeKgPerDay: -0.02,
    slopeKgPerWeek: -0.14,
    points: [
      {
        date: '2093-04-12',
        weightKg: 63.4,
        lowerKg: 63.1,
        upperKg: 63.7,
      },
    ],
  },
  status: 'arrival_estimate',
  reason: null,
  arrivalDateRange: { from: '2093-05-01', to: '2093-05-12' },
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const todayPageOutput = (request: unknown, container: HTMLDivElement) => {
  const card = container.querySelector('section')
  const dayDetails = container.querySelector('[data-testid="day-detail"]')
  const children = Array.from(container.children)
  return {
    request,
    card: (card?.textContent ?? '').replaceAll(/\s+/g, ' ').trim(),
    cardPrecedesTodayDetails:
      children.findIndex((child) => child === card) <
      children.findIndex((child) => child === dayDetails),
  }
}

const todayPageErrorOutput = (
  container: HTMLDivElement,
  requestCount: number,
) => ({
  errorMessage: (container.querySelector('section')?.textContent ?? '')
    .replaceAll(/\s+/g, ' ')
    .trim(),
  requestCount,
})

let root: Root | undefined
let queryClient: QueryClient | undefined
let container = document.createElement('div')

const renderTodayPage = (): void => {
  container = document.createElement('div')
  root = createRoot(container)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const newQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient = newQueryClient
  act(() => {
    root?.render(
      <QueryClientProvider client={newQueryClient}>
        <TodayPage />
      </QueryClientProvider>,
    )
  })
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = undefined
  queryClient?.clear()
  queryClient = undefined
  container = document.createElement('div')
  vi.unstubAllGlobals()
})

describe('TodayPage weight outlook', () => {
  it('loads the outlook and shows the card before today details', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(jsonResponse(outlook))
    vi.stubGlobal('fetch', fetchMock)

    renderTodayPage()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    expect(todayPageOutput(fetchMock.mock.calls[0]?.[0], container)).toEqual({
      request: '/api/weight-outlook',
      card: 'WEIGHT OUTLOOK体重の見通し最新の体重63.4kg直近のトレンド減少傾向週あたり -0.14 kg今のペースが続けば、目標体重への到達時期は 2093年5月1日〜2093年5月12日 ごろです。未検証の目安です。',
      cardPrecedesTodayDetails: true,
    })
  })

  it('shows a retry action when the outlook request fails', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock.mockResolvedValue(jsonResponse({ error: 'unavailable' }, 500))
    vi.stubGlobal('fetch', fetchMock)

    renderTodayPage()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    const retryButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '再読み込み',
    )
    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    expect(
      todayPageErrorOutput(container, fetchMock.mock.calls.length),
    ).toEqual({
      errorMessage:
        'WEIGHT OUTLOOK体重の見通し体重の見通しを読み込めませんでした。再読み込み',
      requestCount: 2,
    })
  })
})
