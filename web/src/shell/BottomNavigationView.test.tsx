import '#index.css'
import '#styles/tokens.css'

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { MealLogSheetContext } from '#meal-log-sheet/MealLogSheetContext'
import { AppShell } from '#shell/AppShell'
import { BottomNavigationView } from '#shell/BottomNavigationView'
import type { NavItem } from '#shell/nav-items'
import { TabBar } from '#shell/TabBar'

const SAMPLE_ITEMS: ReadonlyArray<NavItem> = [
  { label: '星のしるべ', path: '/sample/stars' },
  { label: '月の観測', path: '/sample/moon' },
  { label: '雲の記録', path: '/sample/clouds' },
  { label: '森の地図', path: '/sample/forest' },
  { label: '海の音色', path: '/sample/ocean' },
  { label: '空の便り', path: '/sample/sky' },
]

const SELECTED_PATH = '/sample/stars/catalog'
const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = []

const performAct = (callback: () => void | Promise<void>): Promise<void> =>
  act(async () => {
    await callback()
  })

const createContainer = (): { container: HTMLDivElement; root: Root } => {
  const container = document.createElement('div')
  container.style.width = '100vw'
  document.body.append(container)
  return { container, root: createRoot(container) }
}

const renderInContainer = async (ui: ReactNode): Promise<HTMLDivElement> => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const { container, root } = createContainer()
  mountedRoots.push({ container, root })
  await performAct(() => {
    root.render(ui)
  })
  return container
}

const renderNavigation = async (
  items: ReadonlyArray<NavItem>,
  pathname = SELECTED_PATH,
): Promise<HTMLDivElement> =>
  renderInContainer(
    <MemoryRouter initialEntries={[pathname]}>
      <BottomNavigationView
        aria-label="Sample destinations"
        items={items}
        pathname={pathname}
      />
    </MemoryRouter>,
  )

const measureNavigation = (
  container: HTMLDivElement,
): {
  itemCount: number
  rowCount: number
  overflowsHorizontally: boolean
  selectedHref: string | null | undefined
  viewportWidth: number
} => {
  const navigation = container.querySelector<HTMLElement>(
    'nav[data-slot="bottom-navigation"]',
  )
  const items = Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-slot="bottom-navigation-list"] > li',
    ),
  )
  const rows = new Set(
    items.map((item) => Math.round(item.getBoundingClientRect().top)),
  )

  return {
    itemCount: items.length,
    rowCount: rows.size,
    overflowsHorizontally:
      navigation !== null && navigation.scrollWidth > navigation.clientWidth,
    selectedHref: container
      .querySelector<HTMLAnchorElement>(
        '[data-slot="bottom-navigation-item"][aria-current="page"]',
      )
      ?.getAttribute('href'),
    viewportWidth: window.innerWidth,
  }
}

const LocationProbe = (): React.JSX.Element => {
  const { pathname } = useLocation()
  return <output data-testid="pathname">{pathname}</output>
}

afterEach(async () => {
  if (mountedRoots.length > 0) {
    await performAct(() => {
      for (const { root } of mountedRoots) {
        root.unmount()
      }
    })
    for (const { container } of mountedRoots) {
      container.remove()
    }
    mountedRoots.length = 0
  }
  document.documentElement.style.removeProperty(
    '--mobile-safe-area-inset-bottom',
  )
  vi.unstubAllGlobals()
})

describe('BottomNavigationView', () => {
  it('selects the active nested route and navigates to the selected destination', async () => {
    await page.viewport(375, 800)
    const container = await renderInContainer(
      <MealLogSheetContext.Provider
        value={{ openCreate: vi.fn(), openEdit: vi.fn() }}
      >
        <MemoryRouter initialEntries={['/history/sample-day']}>
          <TabBar />
          <LocationProbe />
        </MemoryRouter>
      </MealLogSheetContext.Provider>,
    )
    const initialState = {
      pathname: container.querySelector('[data-testid="pathname"]')
        ?.textContent,
      selectedHref: container
        .querySelector<HTMLAnchorElement>(
          '[data-slot="bottom-navigation-item"][aria-current="page"]',
        )
        ?.getAttribute('href'),
      rootCurrent: container
        .querySelector<HTMLAnchorElement>('a[href="/"]')
        ?.getAttribute('aria-current'),
    }

    await performAct(() =>
      userEvent.click(page.getByRole('link', { name: '食品' })),
    )

    const finalState = {
      pathname: container.querySelector('[data-testid="pathname"]')
        ?.textContent,
      selectedHref: container
        .querySelector<HTMLAnchorElement>(
          '[data-slot="bottom-navigation-item"][aria-current="page"]',
        )
        ?.getAttribute('href'),
    }

    const getOutput = () => ({ initialState, finalState })

    expect(getOutput()).toEqual({
      initialState: {
        pathname: '/history/sample-day',
        selectedHref: '/history',
        rootCurrent: null,
      },
      finalState: {
        pathname: '/foods',
        selectedHref: '/foods',
      },
    })
  })

  it('opens meal recording from the floating action button', async () => {
    await page.viewport(375, 800)
    const openCreate = vi.fn()
    await renderInContainer(
      <MealLogSheetContext.Provider value={{ openCreate, openEdit: vi.fn() }}>
        <MemoryRouter initialEntries={['/']}>
          <TabBar />
        </MemoryRouter>
      </MealLogSheetContext.Provider>,
    )

    await performAct(() =>
      userEvent.click(page.getByRole('button', { name: '食事を記録' })),
    )

    expect(openCreate.mock.calls).toEqual([[]])
  })

  it('fits five and six destinations in one row at common phone widths', async () => {
    await page.viewport(320, 800)
    const fiveAt320 = measureNavigation(
      await renderNavigation(SAMPLE_ITEMS.slice(0, 5)),
    )
    const sixAt320 = measureNavigation(await renderNavigation(SAMPLE_ITEMS))

    await page.viewport(375, 800)
    const sixAt375 = measureNavigation(await renderNavigation(SAMPLE_ITEMS))

    const getOutput = () => ({ fiveAt320, sixAt320, sixAt375 })

    expect(getOutput()).toEqual({
      fiveAt320: {
        itemCount: 5,
        rowCount: 1,
        overflowsHorizontally: false,
        selectedHref: '/sample/stars',
        viewportWidth: 320,
      },
      sixAt320: {
        itemCount: 6,
        rowCount: 1,
        overflowsHorizontally: false,
        selectedHref: '/sample/stars',
        viewportWidth: 320,
      },
      sixAt375: {
        itemCount: 6,
        rowCount: 1,
        overflowsHorizontally: false,
        selectedHref: '/sample/stars',
        viewportWidth: 375,
      },
    })
  })

  it('keeps the selected item red and the hash monospaced', async () => {
    await page.viewport(320, 800)
    const container = await renderNavigation(SAMPLE_ITEMS)

    const selectedItem = container.querySelector<HTMLElement>(
      '[data-slot="bottom-navigation-item"][aria-current="page"]',
    )
    const icon =
      selectedItem?.querySelector<HTMLElement>(
        '[data-slot="bottom-navigation-icon"]',
      ) ?? null
    const label =
      selectedItem?.querySelector<HTMLElement>(
        '[data-slot="bottom-navigation-label"]',
      ) ?? null
    const getOutput = () => ({
      backgroundColor:
        selectedItem === null
          ? null
          : getComputedStyle(selectedItem).backgroundColor,
      borderTopColor:
        selectedItem === null
          ? null
          : getComputedStyle(selectedItem).borderTopColor,
      color:
        selectedItem === null ? null : getComputedStyle(selectedItem).color,
      iconFontFamily: icon === null ? null : getComputedStyle(icon).fontFamily,
      iconFontSize: icon === null ? null : getComputedStyle(icon).fontSize,
      iconColor: icon === null ? null : getComputedStyle(icon).color,
      labelFontSize: label === null ? null : getComputedStyle(label).fontSize,
    })

    expect(getOutput()).toEqual({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      borderTopColor: 'rgb(239, 68, 68)',
      color: 'rgb(250, 250, 250)',
      iconFontFamily: '"JetBrains Mono", monospace',
      iconFontSize: '16px',
      iconColor: 'rgb(239, 68, 68)',
      labelFontSize: '11px',
    })
  })

  it('scrolls the focused final destination into view when the viewport is narrow', async () => {
    await page.viewport(220, 800)
    const container = await renderNavigation(SAMPLE_ITEMS)

    for (let index = 0; index < SAMPLE_ITEMS.length; index += 1) {
      await userEvent.tab()
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })

    const navigation = container.querySelector<HTMLElement>('nav')
    const lastItem = container.querySelector<HTMLAnchorElement>(
      'a[href="/sample/sky"]',
    )
    const navigationRect = navigation?.getBoundingClientRect()
    const lastItemRect = lastItem?.getBoundingClientRect()

    const getOutput = () => ({
      activeHref: document.activeElement?.getAttribute('href'),
      scrolled: navigation !== null && navigation.scrollLeft > 0,
      finalItemVisible:
        navigationRect !== undefined &&
        lastItemRect !== undefined &&
        lastItemRect.left >= navigationRect.left &&
        lastItemRect.right <= navigationRect.right,
    })

    expect(getOutput()).toEqual({
      activeHref: '/sample/sky',
      scrolled: true,
      finalItemVisible: true,
    })
  })

  it('reserves the safe area and keeps the record button clear of the navigation', async () => {
    await page.viewport(320, 800)
    document.documentElement.style.setProperty(
      '--mobile-safe-area-inset-bottom',
      '16px',
    )
    const container = await renderInContainer(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<div>Sample page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    const navigation = container.querySelector<HTMLElement>(
      'nav[data-slot="bottom-navigation"]',
    )
    const recordButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="食事を記録"]',
    )
    const main = container.querySelector<HTMLElement>('main')
    const navigationRect = navigation?.getBoundingClientRect()
    const recordButtonRect = recordButton?.getBoundingClientRect()

    const getOutput = () => ({
      navigationHeight:
        navigationRect === undefined ? null : Math.round(navigationRect.height),
      safeAreaInset:
        navigationRect === undefined
          ? null
          : Math.round(window.innerHeight - navigationRect.bottom),
      recordButtonGap:
        navigationRect === undefined || recordButtonRect === undefined
          ? null
          : Math.round(navigationRect.top - recordButtonRect.bottom),
      mainBottomPadding:
        main === null ? null : getComputedStyle(main).paddingBottom,
    })

    expect(getOutput()).toEqual({
      navigationHeight: 52,
      safeAreaInset: 16,
      recordButtonGap: 16,
      mainBottomPadding: '68px',
    })
  })
})
