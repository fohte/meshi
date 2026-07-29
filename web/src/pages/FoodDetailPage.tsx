import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import type { FoodDetail, MealType } from '#api/foods'
import { fetchFoodDetail, FoodNotFoundError, SOURCE_LABELS } from '#api/foods'
import type { NutrientDefinition } from '#api/nutrient-definitions'
import { fetchNutrientDefinitions } from '#api/nutrient-definitions'
import { toQueryFn } from '#api/to-query-fn'
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

// The user is a single person based in Japan, so the browser's local clock
// is always JST; no explicit timezone conversion is needed here.
const formatDate = (date: Date): string =>
  `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`

const useFoodDetail = (id: string | undefined) =>
  useQuery<FoodDetail>({
    queryKey: ['foods', 'detail', id],
    queryFn: toQueryFn(() => fetchFoodDetail(id ?? '')),
    enabled: id !== undefined,
    retry: (failureCount, retryError) =>
      !(retryError instanceof FoodNotFoundError) && failureCount < 3,
  })

const useNutrientDefinitions = () =>
  useQuery<ReadonlyArray<NutrientDefinition>>({
    queryKey: ['nutrient-definitions'],
    queryFn: toQueryFn(() => fetchNutrientDefinitions()),
  })

interface NutrientRowProps {
  definition: NutrientDefinition
  nutritionPer100g: FoodDetail['nutritionPer100g']
}

const NutrientRow = ({
  definition,
  nutritionPer100g,
}: NutrientRowProps): React.JSX.Element => {
  const value = nutritionPer100g[definition.code]
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
  const energyKcalPer100g = food.nutritionPer100g['energy_kcal']

  return (
    <div>
      <h1 className={styles.heading}>
        {food.name}
        {food.isEstimated && <span className={styles.estMark}>推定</span>}
      </h1>
      <div className={styles.meta}>
        <span className={styles.sourceBadge}>{SOURCE_LABELS[food.source]}</span>
        <span className={styles.metaText}>100 g あたり</span>
        {food.sourceUrl !== null && isHttpUrl(food.sourceUrl) && (
          <a href={food.sourceUrl} className={styles.sourceLink}>
            出典 →
          </a>
        )}
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionMarker}>##</span>
          <span className={styles.sectionTitle}>栄養成分 (100 g あたり)</span>
        </div>
        <table className={styles.nutrientTable}>
          <tbody>
            {majorDefinitions.map((definition) => (
              <NutrientRow
                key={definition.code}
                definition={definition}
                nutritionPer100g={food.nutritionPer100g}
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
                  nutritionPer100g={food.nutritionPer100g}
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
                energyKcalPer100g === undefined
                  ? null
                  : (energyKcalPer100g * entry.quantity) / 100
              return (
                <div key={entry.id} className={styles.historyRow}>
                  <span className={styles.historyDate}>
                    {formatDate(entry.eatenAt)}
                  </span>
                  <span className={styles.historyMeal}>
                    {MEAL_TYPE_LABELS[entry.mealType]}
                  </span>
                  <span className={styles.historyQty}>
                    {formatNumber(entry.quantity)} {entry.unit}
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
