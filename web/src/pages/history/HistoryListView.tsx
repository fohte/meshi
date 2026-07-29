import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'

import type { MealHistoryDayTotals, MealHistoryEntry } from '#api/meal-history'
import { fetchMealHistory } from '#api/meal-history'
import { toPromise } from '#api/to-promise'
import { ErrorRetry } from '#components/ErrorRetry/ErrorRetry'
import { Skeleton } from '#components/Skeleton/Skeleton'
import { jstDateOf, shiftDateString, todayJstDate } from '#lib/jst-date'
import { buildListCards } from '#pages/history/build-list-cards'
import styles from '#pages/history/HistoryListView.module.css'

const ENERGY_CODE = 'energy_kcal'
const CHUNK_DAYS = 30
// Caps how far back the infinite scroll will fetch (~4 years of 30-day
// pages) so a user who keeps scrolling can't grow this into an unbounded
// number of requests.
const MAX_PAGES = 48

interface HistoryListPage {
  readonly from: string
  readonly to: string
  readonly perDay: ReadonlyArray<MealHistoryDayTotals>
  readonly entries: ReadonlyArray<MealHistoryEntry>
}

const fetchListPage = (to: string): Promise<HistoryListPage> => {
  const from = shiftDateString(to, -CHUNK_DAYS)
  return toPromise(fetchMealHistory(from, to)).then((data) => ({
    from,
    to,
    perDay: data.perDay,
    entries: data.entries,
  }))
}

export interface HistoryListViewProps {
  readonly targets: Readonly<Record<string, number>> | null
}

export const HistoryListView = ({
  targets,
}: HistoryListViewProps): React.JSX.Element => {
  const initialTo = shiftDateString(todayJstDate(), 1)

  const query = useInfiniteQuery({
    queryKey: ['meal-history', 'list'],
    queryFn: ({ pageParam }) => fetchListPage(pageParam),
    initialPageParam: initialTo,
    getNextPageParam: (lastPage, allPages) =>
      allPages.length >= MAX_PAGES ? undefined : lastPage.from,
  })

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = sentinelRef.current
    if (node === null || !query.hasNextPage || query.isFetchingNextPage) {
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void query.fetchNextPage()
      }
    })
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage])

  const energyTarget = targets?.[ENERGY_CODE]
  const pages = query.data?.pages ?? []
  const perDay = pages.flatMap((page) => page.perDay)
  const foodNamesByDate = new Map<string, string[]>()
  for (const entry of pages.flatMap((page) => page.entries)) {
    const date = jstDateOf(entry.eatenAt)
    const names = foodNamesByDate.get(date) ?? []
    names.push(entry.foodName)
    foodNamesByDate.set(date, names)
  }
  const cards = buildListCards(perDay, foodNamesByDate, energyTarget)

  return (
    <div className={styles.list}>
      {query.isError && (
        <ErrorRetry
          onRetry={() => {
            void query.refetch()
          }}
        />
      )}

      {query.isPending && (
        <div className={styles.skeletonStack}>
          <Skeleton height={68} />
          <Skeleton height={68} />
          <Skeleton height={68} />
        </div>
      )}

      {!query.isPending && !query.isError && (
        <>
          {cards.length === 0 && (
            <div className={styles.empty}>記録がありません</div>
          )}
          {cards.map((card) => (
            <Link
              key={card.date}
              to={`/days/${card.date}`}
              className={styles.card}
            >
              <span className={styles.cardDate}>
                <span className={styles.cardDay}>{card.dayText}</span>
                <span className={styles.cardDow}>{card.dowText}</span>
              </span>
              <span className={styles.cardMain}>
                <span className={styles.cardSummary}>{card.summary}</span>
                <span className={styles.cardMeta}>{card.metaText}</span>
              </span>
              <span className={styles.cardStats}>
                <span className={styles.cardKcal}>{card.kcalText}</span>
                <span
                  className={styles.cardPct}
                  data-over={card.isOverTarget ? '' : undefined}
                >
                  {card.pctText}
                </span>
              </span>
            </Link>
          ))}
          {query.hasNextPage && (
            <div ref={sentinelRef} className={styles.loadingMore}>
              {query.isFetchingNextPage ? '読み込み中…' : ''}
            </div>
          )}
        </>
      )}
    </div>
  )
}
