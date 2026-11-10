import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { MealType } from '#api/day-detail'
import { registerFoodMasterFromComposition } from '#api/food-masters'
import { BatchMealLogRequestError, postMealLogs } from '#api/meal-logs'
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
  readonly isRecording: boolean
  readonly mealPlanId: string | null
  readonly reason: string
  readonly items: ReadonlyArray<MealPlanDraftItem>
  readonly nextItemId: number
  readonly selection: MealPlanSheetProps['selection']
  readonly query: string
}

const toMealPlanDraftItems = (
  items: MealPlan['items'],
): ReadonlyArray<MealPlanDraftItem> =>
  items.map((item, id) => ({
    id,
    foodMasterId: item.foodMasterId,
    foodName: item.foodName,
    quantity: String(item.quantity),
    energyKcalPerUnit: item.energyKcalPerUnit,
  }))

export const useDayMealPlan = (date: string) => {
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<MealPlanEditorState | null>(null)

  const invalidateMealPlans = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['meal-plans', date] })
  }
  const invalidateMealLogs = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['day-detail'] })
    void queryClient.invalidateQueries({ queryKey: ['foods'] })
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
  const recordMutation = useMutation({
    mutationFn: (input: MealPlanEditorState) => {
      if (input.mealPlanId === null) {
        return Promise.reject(new Error('meal plan is required to record'))
      }
      return toPromise(
        postMealLogs({
          eatenDate: date,
          mealType: input.mealType,
          mealPlanId: input.mealPlanId,
          items: input.items.map(({ foodMasterId, quantity }) => ({
            foodMasterId,
            quantity: Number(quantity),
          })),
        }),
      )
    },
    onSuccess: () => {
      invalidateMealLogs()
      invalidateMealPlans()
      setEditor(null)
    },
    onError: (error) => {
      if (error instanceof BatchMealLogRequestError && error.status === 409) {
        invalidateMealLogs()
        invalidateMealPlans()
        setEditor(null)
      }
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
    recordMutation.reset()
    compositionMutation.reset()
    setEditor({
      mealType,
      isEditing: plan !== undefined,
      isRecording: false,
      mealPlanId: null,
      reason: plan?.reason ?? '',
      items: plan === undefined ? [] : toMealPlanDraftItems(plan.items),
      nextItemId: plan?.items.length ?? 0,
      selection: null,
      query: '',
    })
  }

  const openForRecord = (plan: MealPlan): void => {
    saveMutation.reset()
    recordMutation.reset()
    compositionMutation.reset()
    setEditor({
      mealType: plan.mealType,
      isEditing: false,
      isRecording: true,
      mealPlanId: plan.id,
      reason: '',
      items: toMealPlanDraftItems(plan.items),
      nextItemId: plan.items.length,
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
    recordMutation.reset()
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
          isRecording: editor.isRecording,
          isSaving: saveMutation.isPending || recordMutation.isPending,
          error: editor.isRecording
            ? recordMutation.isError &&
              !(
                recordMutation.error instanceof BatchMealLogRequestError &&
                recordMutation.error.status === 409
              )
              ? recordMutation.error.message
              : null
            : saveMutation.isError
              ? saveMutation.error.message
              : null,
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
            if (editor.isRecording) {
              recordMutation.mutate(editor)
            } else {
              saveMutation.mutate(editor)
            }
          },
        }

  return {
    open,
    openForRecord,
    cancel: (id: string) => {
      cancelMutation.mutate(id)
    },
    isActionPending:
      saveMutation.isPending ||
      recordMutation.isPending ||
      cancelMutation.isPending,
    cancelError: cancelMutation.isError
      ? {
          planId: cancelMutation.variables,
          message: cancelMutation.error.message,
        }
      : null,
    sheetProps,
  }
}
