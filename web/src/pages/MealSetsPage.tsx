import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import {
  fetchFoodSearch,
  fetchFoodSuggestions,
  type FoodListItem,
} from '#api/foods'
import {
  deleteMealSet,
  fetchMealSets,
  type MealSet,
  patchMealSet,
  postMealSet,
  type SaveMealSetInput,
} from '#api/meal-sets'
import { toPromise } from '#api/to-promise'
import {
  type MealSetDraftItem,
  MealSetEditor,
  type MealSetFoodOption,
} from '#components/MealSetEditor/MealSetEditor'
import styles from '#pages/MealSetsPage.module.css'

const MEAL_SETS_QUERY_KEY = ['meal-sets']
const FOOD_SEARCH_LIMIT = 20
const FOOD_SUGGESTION_LIMIT = 5
const DEBOUNCE_MS = 300

interface EditorState {
  readonly id: string | null
  readonly name: string
  readonly items: ReadonlyArray<MealSetDraftItem>
  readonly foodQuery: string
}

interface SaveRequest {
  readonly id: string | null
  readonly input: SaveMealSetInput
}

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

const toFoodOptions = (
  items: ReadonlyArray<FoodListItem>,
): MealSetFoodOption[] =>
  items
    .filter(
      (item): item is FoodListItem & { foodMasterId: string } =>
        item.foodMasterId !== null,
    )
    .map((item) => ({
      foodMasterId: item.foodMasterId,
      name: item.name,
      energyKcalPerUnit: item.energyKcalPerUnit,
      isEstimated: item.isEstimated,
    }))

const formatQuantity = (quantity: number): string => String(quantity)

const draftItemsFromMealSet = (mealSet: MealSet): MealSetDraftItem[] =>
  mealSet.items.map((item) => ({
    foodMasterId: item.foodMasterId,
    foodName: item.foodName,
    quantity: String(item.quantity),
    energyKcalPerUnit: item.energyKcalPerUnit,
  }))

const getEnergySummary = (mealSet: MealSet): string => {
  const knownItems = mealSet.items.filter(
    (item) => item.energyKcalPerUnit !== null,
  )
  if (knownItems.length === 0) return 'kcal 不明'

  const total = knownItems.reduce((sum, item) => {
    const energyKcalPerUnit = item.energyKcalPerUnit
    return energyKcalPerUnit === null
      ? sum
      : sum + energyKcalPerUnit * item.quantity
  }, 0)
  const formattedTotal = new Intl.NumberFormat('ja-JP', {
    maximumFractionDigits: 0,
  }).format(total)
  const hasUnknownItems = knownItems.length !== mealSet.items.length
  return hasUnknownItems
    ? `約 ${formattedTotal} kcal + 不明`
    : `約 ${formattedTotal} kcal`
}

export const MealSetsPage = (): React.JSX.Element => {
  const mealSetsQuery = useQuery({
    queryKey: MEAL_SETS_QUERY_KEY,
    queryFn: () => toPromise(fetchMealSets()),
  })
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string>()
  const debouncedFoodQuery = useDebouncedValue(
    editor?.foodQuery.trim() ?? '',
    DEBOUNCE_MS,
  )

  const searchQuery = useQuery({
    queryKey: ['foods', 'search', debouncedFoodQuery],
    queryFn: () =>
      toPromise(fetchFoodSearch(debouncedFoodQuery, FOOD_SEARCH_LIMIT)),
    enabled: editor !== null && debouncedFoodQuery !== '',
  })
  const suggestionsQuery = useQuery({
    queryKey: ['foods', 'suggestions'],
    queryFn: () => toPromise(fetchFoodSuggestions(FOOD_SUGGESTION_LIMIT)),
    enabled: editor !== null && debouncedFoodQuery === '',
  })

  const saveMutation = useMutation({
    mutationFn: ({ id, input }: SaveRequest) =>
      toPromise(id === null ? postMealSet(input) : patchMealSet(id, input)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MEAL_SETS_QUERY_KEY })
      setEditor(null)
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => toPromise(deleteMealSet(id)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MEAL_SETS_QUERY_KEY })
      setDeleteTargetId(null)
    },
  })

  const openCreate = (): void => {
    saveMutation.reset()
    deleteMutation.reset()
    setValidationError(undefined)
    setEditor({ id: null, name: '', items: [], foodQuery: '' })
    setDeleteTargetId(null)
  }

  const openEdit = (mealSet: MealSet): void => {
    saveMutation.reset()
    deleteMutation.reset()
    setValidationError(undefined)
    setEditor({
      id: mealSet.id,
      name: mealSet.name,
      items: draftItemsFromMealSet(mealSet),
      foodQuery: '',
    })
    setDeleteTargetId(null)
  }

  const closeEditor = (): void => {
    setEditor(null)
    setValidationError(undefined)
    saveMutation.reset()
  }

  const updateEditor = (
    update: (current: EditorState) => EditorState,
  ): void => {
    setEditor((current) => (current === null ? current : update(current)))
    saveMutation.reset()
    setValidationError(undefined)
  }

  const handleSave = (): void => {
    if (editor === null) return
    const name = editor.name.trim()
    if (name === '') {
      setValidationError('セット名を入力してください。')
      return
    }
    if (editor.items.length === 0) {
      setValidationError('食品を 1 件以上追加してください。')
      return
    }

    const items = editor.items.map((item) => ({
      foodMasterId: item.foodMasterId,
      quantity: Number(item.quantity),
    }))
    if (
      items.some(
        (item) => !Number.isFinite(item.quantity) || item.quantity <= 0,
      )
    ) {
      setValidationError('量は 0 より大きい数を入力してください。')
      return
    }

    setValidationError(undefined)
    saveMutation.mutate({ id: editor.id, input: { name, items } })
  }

  const handleAddFood = (food: MealSetFoodOption): void => {
    updateEditor((current) => {
      if (
        current.items.some((item) => item.foodMasterId === food.foodMasterId)
      ) {
        return current
      }
      return {
        ...current,
        foodQuery: '',
        items: [
          ...current.items,
          {
            foodMasterId: food.foodMasterId,
            foodName: food.name,
            quantity: '1',
            energyKcalPerUnit: food.energyKcalPerUnit,
          },
        ],
      }
    })
  }

  const setEditorName = (name: string): void => {
    updateEditor((current) => ({ ...current, name }))
  }

  const setItemQuantity = (foodMasterId: string, quantity: string): void => {
    updateEditor((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.foodMasterId === foodMasterId ? { ...item, quantity } : item,
      ),
    }))
  }

  const removeFood = (foodMasterId: string): void => {
    updateEditor((current) => ({
      ...current,
      items: current.items.filter((item) => item.foodMasterId !== foodMasterId),
    }))
  }

  const setFoodQuery = (foodQuery: string): void => {
    setEditor((current) =>
      current === null ? current : { ...current, foodQuery },
    )
  }

  const renderContent = (): React.JSX.Element => {
    if (mealSetsQuery.isPending) {
      return <p className={styles.status}>マイセットを読み込み中...</p>
    }
    if (mealSetsQuery.isError) {
      return (
        <div className={styles.error} role="alert">
          <p>マイセットを読み込めませんでした: {mealSetsQuery.error.message}</p>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              void mealSetsQuery.refetch()
            }}
          >
            再試行
          </button>
        </div>
      )
    }

    if (mealSetsQuery.data.length === 0) {
      return (
        <div className={styles.emptyState}>
          <p>マイセットはまだありません。</p>
          <p>よく食べる食品の組み合わせを登録できます。</p>
        </div>
      )
    }

    return (
      <div className={styles.list}>
        {mealSetsQuery.data.map((mealSet) => (
          <article key={mealSet.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>{mealSet.name}</h2>
              <p className={styles.energy}>{getEnergySummary(mealSet)}</p>
            </div>
            <ul className={styles.itemList}>
              {mealSet.items.map((item) => (
                <li key={item.foodMasterId} className={styles.cardItem}>
                  <span>{item.foodName}</span>
                  <span className={styles.quantity}>
                    {formatQuantity(item.quantity)} ×
                  </span>
                </li>
              ))}
            </ul>
            <div className={styles.cardActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                aria-label={`編集 ${mealSet.name}`}
                disabled={editor !== null || deleteMutation.isPending}
                onClick={() => {
                  openEdit(mealSet)
                }}
              >
                編集
              </button>
              <button
                type="button"
                className={styles.deleteButton}
                aria-label={`削除 ${mealSet.name}`}
                disabled={editor !== null || deleteMutation.isPending}
                onClick={() => {
                  setDeleteTargetId(mealSet.id)
                  deleteMutation.reset()
                }}
              >
                削除
              </button>
            </div>
            {deleteTargetId === mealSet.id && (
              <div
                className={styles.deleteConfirmation}
                role="group"
                aria-label={`削除の確認 ${mealSet.name}`}
              >
                <p>{mealSet.name} を削除しますか?</p>
                <button
                  type="button"
                  className={styles.deleteButton}
                  aria-label={`削除を確定 ${mealSet.name}`}
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    deleteMutation.mutate(mealSet.id)
                  }}
                >
                  {deleteMutation.isPending ? '削除中...' : '削除する'}
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    setDeleteTargetId(null)
                    deleteMutation.reset()
                  }}
                >
                  キャンセル
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    )
  }

  const recentFoods = toFoodOptions(suggestionsQuery.data?.recent ?? [])
  const frequentFoods = toFoodOptions(suggestionsQuery.data?.frequent ?? [])
  const searchResults = toFoodOptions(searchQuery.data ?? [])
  const isSearching = debouncedFoodQuery !== ''
  const activeFoodQuery = isSearching ? searchQuery : suggestionsQuery
  const foodSearchError = activeFoodQuery.isError
    ? activeFoodQuery.error.message
    : undefined

  return (
    <div>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.heading}>
            <span className={styles.hash}>#</span> マイセット
          </h1>
          <p className={styles.description}>
            よく食べる食品の組み合わせと量を登録できます。
          </p>
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          aria-label="新しいマイセットを作成"
          disabled={editor !== null}
          onClick={openCreate}
        >
          + 新しいマイセット
        </button>
      </header>

      {deleteMutation.isError && (
        <p className={styles.error} role="alert">
          {deleteMutation.error.message}
        </p>
      )}

      {renderContent()}

      {editor !== null && (
        <div className={styles.editorPanel}>
          <MealSetEditor
            mode={editor.id === null ? 'create' : 'edit'}
            name={editor.name}
            items={editor.items}
            foodQuery={editor.foodQuery}
            recentFoods={recentFoods}
            frequentFoods={frequentFoods}
            searchResults={searchResults}
            isSearching={isSearching}
            isFoodSearchLoading={activeFoodQuery.isPending}
            foodSearchError={foodSearchError}
            isSaving={saveMutation.isPending}
            error={validationError ?? saveMutation.error?.message}
            onNameChange={setEditorName}
            onFoodQueryChange={setFoodQuery}
            onAddFood={handleAddFood}
            onQuantityChange={setItemQuantity}
            onRemoveFood={removeFood}
            onSave={handleSave}
            onCancel={closeEditor}
          />
        </div>
      )}
    </div>
  )
}
