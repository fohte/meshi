import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { MealType } from '#api/day-detail'
import { registerFoodMasterFromComposition } from '#api/food-masters'
import { type MealPlan, postMealPlanCancel, putMealPlan } from '#api/meal-plans'
import { toPromise } from '#api/to-promise'
import type {
  MealPlanDraftItem,
  MealPlanSheetProps,
} from '#components/MealPlanSheet/MealPlanSheet'
import {
  applyFoodItemSelection,
  removeFoodItem,
  type SelectedFood,
  setFoodItemQuantity,
} from '#meal-log-sheet/food-item-list'

interface MealPlanEditorState {
  readonly mealType: MealType
  readonly isEditing: boolean
  readonly reason: string
  readonly items: ReadonlyArray<MealPlanDraftItem>
  readonly nextItemId: number
  readonly selection: MealPlanSheetProps['selection']
  readonly query: string
}

export const useDayMealPlan = (date: string) => {
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<MealPlanEditorState | null>(null)

  const invalidateMealPlans = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['meal-plans', date] })
  }

  const saveMutation = useMutation({
    mutationFn: (input: MealPlanEditorState) =>
      toPromise(
        putMealPlan(date, input.mealType, {
          ...(input.reason.trim() === '' ? {} : { reason: input.reason }),
          items: input.items.map(({ foodMasterId, foodName, quantity }) => ({
            foodMasterId,
            foodName,
            quantity: Number(quantity),
          })),
        }),
      ),
    onSuccess: () => {
      invalidateMealPlans()
      setEditor(null)
    },
  })
  const cancelMutation = useMutation({
    mutationFn: (id: string) => toPromise(postMealPlanCancel(id)),
    onSuccess: invalidateMealPlans,
  })
  const compositionMutation = useMutation({
    mutationFn: (compositionCode: string) =>
      toPromise(registerFoodMasterFromComposition(compositionCode)),
    onSuccess: (foodMaster) => {
      addFoodToEditor({
        foodMasterId: foodMaster.id,
        name: foodMaster.name,
        isEstimated: foodMaster.isEstimated,
        energyKcalPerUnit: foodMaster.nutrition['energy_kcal'] ?? null,
      })
    },
  })

  const open = (mealType: MealType, plan?: MealPlan): void => {
    saveMutation.reset()
    compositionMutation.reset()
    setEditor({
      mealType,
      isEditing: plan !== undefined,
      reason: plan?.reason ?? '',
      items:
        plan?.items.map((item, id) => ({
          id,
          foodMasterId: item.foodMasterId,
          foodName: item.foodName,
          quantity: String(item.quantity),
          energyKcalPerUnit: item.energyKcalPerUnit,
        })) ?? [],
      nextItemId: plan?.items.length ?? 0,
      selection: null,
      query: '',
    })
  }

  const addFoodToEditor = (food: SelectedFood): void => {
    setEditor((current) => {
      if (current === null || current.selection === null) return current
      const updated = applyFoodItemSelection(
        current.items,
        current.nextItemId,
        current.selection,
        food,
      )
      return {
        ...current,
        selection: null,
        query: '',
        ...updated,
      }
    })
    compositionMutation.reset()
  }

  const close = (): void => {
    saveMutation.reset()
    compositionMutation.reset()
    setEditor(null)
  }

  const sheetProps: MealPlanSheetProps | null =
    editor === null
      ? null
      : {
          date,
          mealType: editor.mealType,
          isEditing: editor.isEditing,
          reason: editor.reason,
          items: editor.items,
          selection: editor.selection,
          query: editor.query,
          isSaving: saveMutation.isPending,
          error: saveMutation.isError ? saveMutation.error.message : null,
          isRegisteringComposition: compositionMutation.isPending,
          compositionError: compositionMutation.isError,
          close,
          setReason: (reason) => {
            setEditor((current) =>
              current === null ? current : { ...current, reason },
            )
          },
          setQuery: (query) => {
            setEditor((current) =>
              current === null ? current : { ...current, query },
            )
          },
          selectFood: addFoodToEditor,
          selectComposition: (compositionCode) => {
            compositionMutation.mutate(compositionCode)
          },
          backToItems: () => {
            setEditor((current) =>
              current === null
                ? current
                : { ...current, selection: null, query: '' },
            )
          },
          setQuantity: (id, quantity) => {
            setEditor((current) =>
              current === null
                ? current
                : {
                    ...current,
                    items: setFoodItemQuantity(current.items, id, quantity),
                  },
            )
          },
          removeItem: (id) => {
            setEditor((current) =>
              current === null
                ? current
                : {
                    ...current,
                    items: removeFoodItem(current.items, id),
                  },
            )
          },
          replaceItem: (itemId) => {
            setEditor((current) =>
              current === null
                ? current
                : {
                    ...current,
                    selection: { type: 'replace', itemId },
                    query: '',
                  },
            )
          },
          addItem: () => {
            setEditor((current) =>
              current === null
                ? current
                : { ...current, selection: { type: 'add' }, query: '' },
            )
          },
          save: () => {
            saveMutation.mutate(editor)
          },
        }

  return {
    open,
    cancel: (id: string) => {
      cancelMutation.mutate(id)
    },
    isActionPending: saveMutation.isPending || cancelMutation.isPending,
    cancelError: cancelMutation.isError
      ? {
          planId: cancelMutation.variables,
          message: cancelMutation.error.message,
        }
      : null,
    sheetProps,
  }
}
