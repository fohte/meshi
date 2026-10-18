import styles from '#components/MealSetEditor/MealSetEditor.module.css'

export interface MealSetFoodOption {
  readonly foodMasterId: string
  readonly name: string
  readonly energyKcalPerUnit: number | null
  readonly isEstimated: boolean
}

export interface MealSetDraftItem {
  readonly foodMasterId: string
  readonly foodName: string
  readonly quantity: string
  readonly energyKcalPerUnit: number | null
}

interface MealSetEditorProps {
  readonly mode: 'create' | 'edit'
  readonly name: string
  readonly items: ReadonlyArray<MealSetDraftItem>
  readonly foodQuery: string
  readonly recentFoods: ReadonlyArray<MealSetFoodOption>
  readonly frequentFoods: ReadonlyArray<MealSetFoodOption>
  readonly searchResults: ReadonlyArray<MealSetFoodOption>
  readonly isSearching: boolean
  readonly isFoodSearchLoading?: boolean
  readonly foodSearchError?: string | undefined
  readonly isSaving?: boolean
  readonly error?: string | undefined
  readonly onNameChange: (name: string) => void
  readonly onFoodQueryChange: (query: string) => void
  readonly onAddFood: (food: MealSetFoodOption) => void
  readonly onQuantityChange: (foodMasterId: string, quantity: string) => void
  readonly onRemoveFood: (foodMasterId: string) => void
  readonly onSave: () => void
  readonly onCancel: () => void
}

export const MealSetEditor = ({
  mode,
  name,
  items,
  foodQuery,
  recentFoods,
  frequentFoods,
  searchResults,
  isSearching,
  isFoodSearchLoading = false,
  foodSearchError,
  isSaving = false,
  error,
  onNameChange,
  onFoodQueryChange,
  onAddFood,
  onQuantityChange,
  onRemoveFood,
  onSave,
  onCancel,
}: MealSetEditorProps): React.JSX.Element => {
  const selectedFoodIds = new Set(items.map((item) => item.foodMasterId))

  return (
    <section className={styles.editor} aria-labelledby="meal-set-editor-title">
      <div className={styles.header}>
        <h2 id="meal-set-editor-title" className={styles.title}>
          <span className={styles.sectionMarker}>##</span>
          {mode === 'create' ? '新しいマイセット' : 'マイセットを編集'}
        </h2>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onCancel}
          aria-label="編集をキャンセル"
        >
          ×
        </button>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSave()
        }}
      >
        <label className={styles.fieldLabel} htmlFor="meal-set-name">
          セット名
        </label>
        <input
          id="meal-set-name"
          className={styles.textInput}
          required
          value={name}
          onChange={(event) => {
            onNameChange(event.currentTarget.value)
          }}
          placeholder="セット名を入力"
          disabled={isSaving}
        />

        <div className={styles.itemsHeader}>
          <h3 className={styles.fieldLabel}>食品と量</h3>
          <span className={styles.hint}>量は食品 1 つ分に対する倍率です</span>
        </div>
        {items.length === 0 ? (
          <div className={styles.emptyItems}>
            食品を検索して追加してください
          </div>
        ) : (
          <ul className={styles.selectedItems}>
            {items.map((item) => (
              <li key={item.foodMasterId} className={styles.selectedItem}>
                <span className={styles.itemName}>{item.foodName}</span>
                <label className={styles.quantityField}>
                  <span className={styles.srOnly}>{item.foodName} の量</span>
                  <input
                    className={styles.quantityInput}
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={item.quantity}
                    disabled={isSaving}
                    aria-label={`${item.foodName} の量`}
                    onChange={(event) => {
                      onQuantityChange(
                        item.foodMasterId,
                        event.currentTarget.value,
                      )
                    }}
                  />
                  <span>×</span>
                </label>
                <button
                  type="button"
                  className={styles.removeButton}
                  disabled={isSaving}
                  aria-label={`${item.foodName} を削除`}
                  onClick={() => {
                    onRemoveFood(item.foodMasterId)
                  }}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className={styles.fieldLabel} htmlFor="meal-set-food-search">
          食品を追加
        </label>
        <div className={styles.searchBox}>
          <span className={styles.searchPrompt} aria-hidden="true">
            &gt;
          </span>
          <input
            id="meal-set-food-search"
            className={styles.searchInput}
            value={foodQuery}
            onChange={(event) => {
              onFoodQueryChange(event.currentTarget.value)
            }}
            placeholder="食品名で検索"
            disabled={isSaving}
          />
          {foodQuery !== '' && (
            <button
              type="button"
              className={styles.clearButton}
              disabled={isSaving}
              onClick={() => {
                onFoodQueryChange('')
              }}
            >
              clear
            </button>
          )}
        </div>

        {foodSearchError !== undefined ? (
          <p className={styles.error} role="alert">
            {foodSearchError}
          </p>
        ) : isFoodSearchLoading ? (
          <p className={styles.searchStatus}>検索中...</p>
        ) : isSearching ? (
          <FoodOptions
            items={searchResults}
            selectedFoodIds={selectedFoodIds}
            emptyText="該当する食品がありません"
            onAddFood={onAddFood}
          />
        ) : (
          <>
            <FoodSection
              title="最近食べた"
              items={recentFoods}
              emptyText="最近の食品はありません"
              selectedFoodIds={selectedFoodIds}
              onAddFood={onAddFood}
            />
            <FoodSection
              title="よく食べる"
              items={frequentFoods}
              emptyText="よく食べる食品はありません"
              selectedFoodIds={selectedFoodIds}
              onAddFood={onAddFood}
            />
          </>
        )}

        {error !== undefined && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {items.length === 0 && (
          <p className={styles.validationHint}>
            食品を 1 件以上追加してください
          </p>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={isSaving}
            onClick={onCancel}
          >
            キャンセル
          </button>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={isSaving || items.length === 0}
          >
            {isSaving
              ? '保存中...'
              : mode === 'create'
                ? '作成する'
                : '保存する'}
          </button>
        </div>
      </form>
    </section>
  )
}

interface FoodOptionsProps {
  readonly items: ReadonlyArray<MealSetFoodOption>
  readonly selectedFoodIds: ReadonlySet<string>
  readonly emptyText: string
  readonly onAddFood: (food: MealSetFoodOption) => void
}

const FoodOptions = ({
  items,
  selectedFoodIds,
  emptyText,
  onAddFood,
}: FoodOptionsProps): React.JSX.Element => {
  const availableItems = items.filter(
    (item) => !selectedFoodIds.has(item.foodMasterId),
  )

  if (availableItems.length === 0) {
    return <div className={styles.emptySearch}>{emptyText}</div>
  }

  return (
    <ul className={styles.foodList}>
      {availableItems.map((item) => (
        <li key={item.foodMasterId}>
          <button
            type="button"
            className={styles.foodOption}
            aria-label={`食品を追加 ${item.name}`}
            onClick={() => {
              onAddFood(item)
            }}
          >
            <span className={styles.foodName}>
              {item.name}
              {item.isEstimated && (
                <span className={styles.estimated}>推定</span>
              )}
            </span>
            <span className={styles.foodKcal}>
              {item.energyKcalPerUnit === null
                ? 'kcal 不明'
                : `約 ${String(Math.round(item.energyKcalPerUnit))} kcal`}
              <span className={styles.addMark} aria-hidden="true">
                +
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

interface FoodSectionProps {
  readonly title: string
  readonly items: ReadonlyArray<MealSetFoodOption>
  readonly emptyText: string
  readonly selectedFoodIds: ReadonlySet<string>
  readonly onAddFood: (food: MealSetFoodOption) => void
}

const FoodSection = ({
  title,
  items,
  emptyText,
  selectedFoodIds,
  onAddFood,
}: FoodSectionProps): React.JSX.Element => (
  <section className={styles.foodSection}>
    <h3 className={styles.foodSectionTitle}>{title}</h3>
    <FoodOptions
      items={items}
      selectedFoodIds={selectedFoodIds}
      emptyText={emptyText}
      onAddFood={onAddFood}
    />
  </section>
)
