import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { FoodListItem } from '#api/foods'
import {
  fetchFoodSearch,
  fetchFoodSuggestions,
  SOURCE_LABELS,
} from '#api/foods'
import { toPromise } from '#api/to-promise'
import styles from '#meal-log-sheet/FoodSearchStep.module.css'
import type { SelectedFood } from '#meal-log-sheet/sheet-state'

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

const kcalText = (value: number | null): string =>
  value === null ? '—' : String(Math.round(value))

export interface FoodSearchStepProps {
  readonly query: string
  readonly setQuery: (query: string) => void
  readonly selectFood: (food: SelectedFood) => void
  readonly selectComposition: (compositionCode: string) => void
  readonly isRegisteringComposition: boolean
  readonly compositionError: boolean
}

export const FoodSearchStep = ({
  query,
  setQuery,
  selectFood,
  selectComposition,
  isRegisteringComposition,
  compositionError,
}: FoodSearchStepProps): React.JSX.Element => {
  const debouncedQuery = useDebouncedValue(query.trim(), DEBOUNCE_MS)
  const isSearching = debouncedQuery !== ''

  const searchQuery = useQuery({
    queryKey: ['foods', 'search', debouncedQuery],
    queryFn: () => toPromise(fetchFoodSearch(debouncedQuery, SEARCH_LIMIT)),
    enabled: isSearching,
  })
  const suggestionsQuery = useQuery({
    queryKey: ['foods', 'suggestions'],
    queryFn: () => toPromise(fetchFoodSuggestions(SUGGESTION_LIMIT)),
    enabled: !isSearching,
  })

  return (
    <div>
      <div className={styles.searchBox}>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
          }}
          placeholder="食品名を入力"
          className={styles.searchInput}
        />
      </div>

      {isSearching ? (
        <SearchResults
          items={searchQuery.data ?? []}
          isLoading={searchQuery.isLoading}
          selectFood={selectFood}
          selectComposition={selectComposition}
          isRegisteringComposition={isRegisteringComposition}
          compositionError={compositionError}
          query={debouncedQuery}
        />
      ) : (
        <Suggestions
          recent={suggestionsQuery.data?.recent ?? []}
          frequent={suggestionsQuery.data?.frequent ?? []}
          selectFood={selectFood}
        />
      )}
    </div>
  )
}

interface FoodRowProps {
  readonly item: FoodListItem
  readonly onSelect: () => void
}

const FoodRow = ({ item, onSelect }: FoodRowProps): React.JSX.Element => (
  <button type="button" className={styles.row} onClick={onSelect}>
    <span className={styles.rowMain}>
      <span className={styles.rowName}>{item.name}</span>
      {item.isEstimated && <span className={styles.rowEstMark}> ~</span>}
      {item.source !== null && (
        <span className={styles.rowMeta}>{SOURCE_LABELS[item.source]}</span>
      )}
    </span>
    <span className={styles.rowKcal}>{kcalText(item.energyKcalPerUnit)}</span>
  </button>
)

interface FoodSectionProps {
  readonly title: string
  readonly items: ReadonlyArray<FoodListItem>
  readonly emptyText: string
  readonly selectFood: (food: SelectedFood) => void
}

const FoodSection = ({
  title,
  items,
  emptyText,
  selectFood,
}: FoodSectionProps): React.JSX.Element => (
  <div className={styles.section}>
    <div className={styles.sectionTitle}>{title}</div>
    {items.length === 0 ? (
      <div className={styles.empty}>{emptyText}</div>
    ) : (
      <div className={styles.list}>
        {items.map((item) => {
          const { foodMasterId } = item
          if (foodMasterId === null) return null
          return (
            <FoodRow
              key={foodMasterId}
              item={item}
              onSelect={() => {
                selectFood({
                  foodMasterId,
                  name: item.name,
                  isEstimated: item.isEstimated,
                  energyKcalPerUnit: item.energyKcalPerUnit,
                })
              }}
            />
          )
        })}
      </div>
    )}
  </div>
)

interface SuggestionsProps {
  readonly recent: ReadonlyArray<FoodListItem>
  readonly frequent: ReadonlyArray<FoodListItem>
  readonly selectFood: (food: SelectedFood) => void
}

const Suggestions = ({
  recent,
  frequent,
  selectFood,
}: SuggestionsProps): React.JSX.Element => (
  <div>
    <FoodSection
      title="最近食べた"
      items={recent}
      emptyText="まだ記録がありません"
      selectFood={selectFood}
    />
    <FoodSection
      title="よく食べる"
      items={frequent}
      emptyText="まだ記録がありません"
      selectFood={selectFood}
    />
  </div>
)

interface SearchResultsProps {
  readonly items: ReadonlyArray<FoodListItem>
  readonly isLoading: boolean
  readonly selectFood: (food: SelectedFood) => void
  readonly selectComposition: (compositionCode: string) => void
  readonly isRegisteringComposition: boolean
  readonly compositionError: boolean
  readonly query: string
}

const SearchResults = ({
  items,
  isLoading,
  selectFood,
  selectComposition,
  isRegisteringComposition,
  compositionError,
  query,
}: SearchResultsProps): React.JSX.Element => {
  if (isLoading) {
    return <div className={styles.empty}>検索中...</div>
  }

  const masterItems = items.filter((item) => item.foodMasterId !== null)
  const compositionItems = items.filter(
    (item) => item.foodMasterId === null && item.compositionCode !== null,
  )

  if (masterItems.length === 0 && compositionItems.length === 0) {
    return (
      <div className={styles.noResult}>
        候補が見つかりませんでした。
        <br />
        <span className={styles.noResultHint}>
          v1 では Slack から「{query} を食べた」と送ると登録できます。
        </span>
      </div>
    )
  }

  return (
    <div>
      <FoodSection
        title="食品マスタ"
        items={masterItems}
        emptyText="マスタに一致する食品はありません"
        selectFood={selectFood}
      />
      {compositionItems.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>新規追加候補</div>
          <div className={styles.sectionHint}>
            日本食品標準成分表(八訂)増補2023年 ·
            選ぶとマスタに推定値として追加されます
          </div>
          <div className={styles.list}>
            {compositionItems.map((item) => {
              const { compositionCode } = item
              if (compositionCode === null) return null
              return (
                <button
                  key={compositionCode}
                  type="button"
                  className={styles.row}
                  disabled={isRegisteringComposition}
                  onClick={() => {
                    selectComposition(compositionCode)
                  }}
                >
                  <span className={styles.rowMain}>
                    <span className={styles.rowName}>{item.name}</span>
                  </span>
                  <span className={styles.rowKcal}>
                    {isRegisteringComposition ? '登録中...' : '追加'}
                  </span>
                </button>
              )
            })}
          </div>
          {compositionError && (
            <div className={styles.errorMessage}>
              食品の登録に失敗しました。しばらくしてから再度お試しください。
            </div>
          )}
        </div>
      )}
    </div>
  )
}
