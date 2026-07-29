import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import type { FoodListItem } from '#api/foods'
import {
  fetchFoodSearch,
  fetchFoodSuggestions,
  SOURCE_LABELS,
} from '#api/foods'
import { toPromise } from '#api/to-promise'
import styles from '#pages/FoodsPage.module.css'
import { QueryState } from '#pages/QueryState'

const DEBOUNCE_MS = 300
const SEARCH_LIMIT = 20
const SUGGESTION_LIMIT = 5

const useDebouncedValue = (value: string, delayMs: number): string => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value)
    }, delayMs)
    return () => {
      clearTimeout(timer)
    }
  }, [value, delayMs])
  return debounced
}

const useFoodSearch = (query: string) =>
  useQuery<ReadonlyArray<FoodListItem>>({
    queryKey: ['foods', 'search', query],
    queryFn: () => toPromise(fetchFoodSearch(query, SEARCH_LIMIT)),
    enabled: query !== '',
  })

const useFoodSuggestions = (enabled: boolean) =>
  useQuery<{
    recent: ReadonlyArray<FoodListItem>
    frequent: ReadonlyArray<FoodListItem>
  }>({
    queryKey: ['foods', 'suggestions'],
    queryFn: () => toPromise(fetchFoodSuggestions(SUGGESTION_LIMIT)),
    enabled,
  })

const kcalText = (value: number | null): string =>
  value === null ? '—' : String(Math.round(value))

interface FoodRowProps {
  item: FoodListItem
}

const FoodRow = ({ item }: FoodRowProps): React.JSX.Element | null => {
  if (item.foodMasterId === null || item.source === null) return null

  return (
    <Link to={`/foods/${item.foodMasterId}`} className={styles.row}>
      <span className={styles.rowMain}>
        <span className={styles.rowName}>{item.name}</span>
        {item.isEstimated && <span className={styles.rowEstMark}>推定</span>}
        <span className={styles.rowMeta}>{SOURCE_LABELS[item.source]}</span>
      </span>
      <span className={styles.rowKcal}>
        {kcalText(item.energyKcalPer100g)}
        <span className={styles.rowKcalCaption}>/ 100 g</span>
      </span>
    </Link>
  )
}

interface FoodSectionProps {
  title: string
  items: ReadonlyArray<FoodListItem>
}

const FoodSection = ({ title, items }: FoodSectionProps): React.JSX.Element => {
  const registered = items.filter((item) => item.foodMasterId !== null)

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionMarker}>##</span>
        <span className={styles.sectionTitle}>{title}</span>
        <span className={styles.sectionCount}>{registered.length} 件</span>
      </div>
      {registered.length === 0 ? (
        <div className={styles.empty}>該当する食品がありません</div>
      ) : (
        <div className={styles.list}>
          {registered.map((item) => (
            <FoodRow key={item.foodMasterId} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}

export const FoodsPage = (): React.JSX.Element => {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query.trim(), DEBOUNCE_MS)
  const isSearching = debouncedQuery !== ''

  const searchQuery = useFoodSearch(isSearching ? debouncedQuery : '')
  const suggestionsQuery = useFoodSuggestions(!isSearching)

  const activeQuery = isSearching ? searchQuery : suggestionsQuery
  const sections = isSearching
    ? [{ title: '検索結果', items: searchQuery.data ?? [] }]
    : [
        { title: '最近食べた', items: suggestionsQuery.data?.recent ?? [] },
        { title: 'よく食べる', items: suggestionsQuery.data?.frequent ?? [] },
      ]

  return (
    <div>
      <h1 className={styles.heading}>
        <span className={styles.hash}>#</span> 食品
      </h1>
      <div className={styles.searchBox}>
        <span className={styles.searchPrompt}>&gt;</span>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
          }}
          placeholder="食品名で検索 (あいまい検索)"
          className={styles.searchInput}
        />
        {query !== '' && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
            }}
            className={styles.clearButton}
          >
            clear
          </button>
        )}
      </div>
      <QueryState
        isLoading={activeQuery.isLoading}
        error={activeQuery.error}
        onRetry={() => {
          void activeQuery.refetch()
        }}
      >
        {sections.map((section) => (
          <FoodSection
            key={section.title}
            title={section.title}
            items={section.items}
          />
        ))}
      </QueryState>
    </div>
  )
}
