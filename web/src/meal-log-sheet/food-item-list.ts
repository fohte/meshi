export interface SelectedFood {
  readonly foodMasterId: string
  readonly name: string
  readonly isEstimated: boolean
  readonly energyKcalPerUnit: number | null
}

export interface EditableFoodItem {
  readonly id: number
  readonly foodMasterId: string
  readonly foodName: string
  readonly quantity: string
  readonly energyKcalPerUnit: number | null
}

export type FoodItemSelection =
  | { readonly type: 'add' }
  | { readonly type: 'replace'; readonly itemId: number }

export const applyFoodItemSelection = (
  items: ReadonlyArray<EditableFoodItem>,
  nextItemId: number,
  selection: FoodItemSelection,
  food: SelectedFood,
): {
  readonly items: ReadonlyArray<EditableFoodItem>
  readonly nextItemId: number
} => {
  if (selection.type === 'replace') {
    return {
      nextItemId,
      items: items.map((item) =>
        item.id === selection.itemId
          ? {
              ...item,
              foodMasterId: food.foodMasterId,
              foodName: food.name,
              energyKcalPerUnit: food.energyKcalPerUnit,
            }
          : item,
      ),
    }
  }

  return {
    nextItemId: nextItemId + 1,
    items: [
      ...items,
      {
        id: nextItemId,
        foodMasterId: food.foodMasterId,
        foodName: food.name,
        quantity: '1',
        energyKcalPerUnit: food.energyKcalPerUnit,
      },
    ],
  }
}

export const setFoodItemQuantity = (
  items: ReadonlyArray<EditableFoodItem>,
  itemId: number,
  quantity: string,
): ReadonlyArray<EditableFoodItem> =>
  items.map((item) => (item.id === itemId ? { ...item, quantity } : item))

export const removeFoodItem = (
  items: ReadonlyArray<EditableFoodItem>,
  itemId: number,
): ReadonlyArray<EditableFoodItem> => items.filter((item) => item.id !== itemId)
