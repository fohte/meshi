import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import type { FoodDetail, MealType } from '#api/foods'
import { fetchFoodDetail, FoodNotFoundError, SOURCE_LABELS } from '#api/foods'
import type { NutrientDefinition } from '#api/nutrient-definitions'
import { fetchNutrientDefinitions } from '#api/nutrient-definitions'
import { toPromise } from '#api/to-promise'
import styles from '#pages/FoodDetailPage.module.css'
import { QueryState } from '#pages/QueryState'

const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: '朝食',
  lunch: '昼食',
  dinner: '夕食',
  snack: '間食',
}

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1)

// food_masters.source_url is populated from web-search results with no
// scheme restriction on write; rendering it as an <a href> without this
// guard would let a javascript: URI execute in the app's origin.
const isHttpUrl = (url: string): boolean =>
  url.startsWith('http://') || url.startsWith('https://')

// eatenDate is already a JST calendar date (YYYY-MM-DD), so this just slices
// out the month/day rather than going through Date.
const formatDate = (eatenDate: string): string => {
  const [, month, day] = eatenDate.split('-')
  return `${month ?? ''}/${day ?? ''}`
}

const useFoodDetail = (id: string | undefined) =>
  useQuery<FoodDetail>({
    queryKey: ['foods', 'detail', id],
    queryFn: () => toPromise(fetchFoodDetail(id ?? '')),
    enabled: id !== undefined,
    retry: (failureCount, retryError) =>
      !(retryError instanceof FoodNotFoundError) && failureCount < 3,
  })

const useNutrientDefinitions = () =>
  useQuery<ReadonlyArray<NutrientDefinition>>({
    queryKey: ['nutrient-definitions'],
    queryFn: () => toPromise(fetchNutrientDefinitions()),
  })

interface NutrientRowProps {
  definition: NutrientDefinition
  nutrition: FoodDetail['nutrition']
}

const NutrientRow = ({
  definition,
  nutrition,
}: NutrientRowProps): React.JSX.Element => {
  const value = nutrition[definition.code]
  return (
    <tr>
      <td className={styles.nutrientLabel}>{definition.displayName}</td>
      <td className={styles.nutrientValue}>
        {value === undefined
          ? '—'
          : `${formatNumber(value)} ${definition.unit}`}
      </td>
    </tr>
  )
}

interface FoodDetailContentProps {
  food: FoodDetail
  nutrientDefinitions: ReadonlyArray<NutrientDefinition>
}

const FoodDetailContent = ({
  food,
  nutrientDefinitions,
}: FoodDetailContentProps): React.JSX.Element => {
  const [showAllNutrients, setShowAllNutrients] = useState(false)
  const majorDefinitions = nutrientDefinitions.filter((d) => d.isMajor)
  const minorDefinitions = nutrientDefinitions.filter((d) => !d.isMajor)
  const energyKcalPerUnit = food.nutrition['energy_kcal']

  return (
    <div>
      <h1 className={styles.heading}>
        {food.name}
        {food.isEstimated && <span className={styles.estMark}>推定</span>}
      </h1>
      <div className={styles.meta}>
        <span className={styles.sourceBadge}>{SOURCE_LABELS[food.source]}</span>
        {food.sourceUrl !== null && isHttpUrl(food.sourceUrl) && (
          <a href={food.sourceUrl} className={styles.sourceLink}>
            出典 →
          </a>
        )}
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionMarker}>##</span>
          <span className={styles.sectionTitle}>栄養成分</span>
        </div>
        <table className={styles.nutrientTable}>
          <tbody>
            {majorDefinitions.map((definition) => (
              <NutrientRow
                key={definition.code}
                definition={definition}
                nutrition={food.nutrition}
              />
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => {
            setShowAllNutrients((v) => !v)
          }}
        >
          {showAllNutrients ? '閉じる' : '全栄養素を表示'}
        </button>
        {showAllNutrients && (
          <table className={styles.nutrientTableMinor}>
            <tbody>
              {minorDefinitions.map((definition) => (
                <NutrientRow
                  key={definition.code}
                  definition={definition}
                  nutrition={food.nutrition}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionMarker}>##</span>
          <span className={styles.sectionTitle}>別名</span>
        </div>
        {food.aliases.length === 0 ? (
          <div className={styles.emptyText}>登録されていません</div>
        ) : (
          <div className={styles.aliasList}>
            {food.aliases.map((alias) => (
              <span key={alias} className={styles.aliasChip}>
                {alias}
              </span>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionMarker}>##</span>
          <span className={styles.sectionTitle}>喫食履歴</span>
          <span className={styles.historyCount}>
            累計 {food.totalEatenCount} 回
          </span>
        </div>
        {food.history.length === 0 ? (
          <div className={styles.emptyText}>まだ記録がありません</div>
        ) : (
          <div className={styles.historyList}>
            {food.history.map((entry) => {
              const kcal =
                energyKcalPerUnit === undefined
                  ? null
                  : energyKcalPerUnit * entry.quantity
              return (
                <div key={entry.id} className={styles.historyRow}>
                  <span className={styles.historyDate}>
                    {formatDate(entry.eatenDate)}
                  </span>
                  <span className={styles.historyMeal}>
                    {MEAL_TYPE_LABELS[entry.mealType]}
                  </span>
                  <span className={styles.historyQty}>
                    ×{formatNumber(entry.quantity)}
                  </span>
                  <span className={styles.historyKcal}>
                    {kcal === null ? '—' : `${String(Math.round(kcal))} kcal`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

export const FoodDetailPage = (): React.JSX.Element => {
  const { id } = useParams<{ id: string }>()
  const detailQuery = useFoodDetail(id)
  const nutrientsQuery = useNutrientDefinitions()

  if (detailQuery.error instanceof FoodNotFoundError) {
    return (
      <div>
        <Link to="/foods" className={styles.back}>
          ← 食品一覧
        </Link>
        <div className={styles.notFound}>食品が見つかりません</div>
      </div>
    )
  }

  return (
    <div>
      <Link to="/foods" className={styles.back}>
        ← 食品一覧
      </Link>
      <QueryState
        isLoading={detailQuery.isLoading || nutrientsQuery.isLoading}
        error={detailQuery.error ?? nutrientsQuery.error}
        onRetry={() => {
          void detailQuery.refetch()
          void nutrientsQuery.refetch()
        }}
      >
        {detailQuery.data !== undefined &&
          nutrientsQuery.data !== undefined && (
            <FoodDetailContent
              food={detailQuery.data}
              nutrientDefinitions={nutrientsQuery.data}
            />
          )}
      </QueryState>
    </div>
  )
}
