import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import type { DayDetailEntry, MealType } from '#api/day-detail'
import type { RegisteredFoodMaster } from '#api/food-masters'
import { registerFoodMasterFromComposition } from '#api/food-masters'
import {
  BatchMealLogRequestError,
  deleteMealLog,
  type MealLogResult,
  patchMealLog,
  postMealLog,
  postMealLogs,
} from '#api/meal-logs'
import type { MealSet } from '#api/meal-sets'
import { fetchMealSets } from '#api/meal-sets'
import { toPromise } from '#api/to-promise'
import { MealLogSheet } from '#meal-log-sheet/MealLogSheet'
import { MealLogSheetContext } from '#meal-log-sheet/MealLogSheetContext'
import {
  applyFoodSelection,
  applyMealSetFoodSelection,
  backToSearch as applyBackToSearch,
  beginMealSetFoodSelection,
  buildContinueState,
  buildCreateState,
  buildEditState,
  buildMealSetRecordState,
  buildMealSetSavePayload,
  buildSavePayload,
  cancelMealSetFoodSelection,
  removeMealSetItem as removeMealSetRecordItem,
  type SelectedFood,
  setCreateTab as changeCreateTab,
  setMealSetItemQuantity as changeMealSetItemQuantity,
  type SheetState,
} from '#meal-log-sheet/sheet-state'

export interface MealLogSheetProviderProps {
  readonly children: React.ReactNode
}

interface SaveVariables {
  readonly continueCreating: boolean
  readonly sheetId: number
}

const toSelectedFood = (foodMaster: RegisteredFoodMaster): SelectedFood => ({
  foodMasterId: foodMaster.id,
  name: foodMaster.name,
  isEstimated: foodMaster.isEstimated,
  energyKcalPerUnit: foodMaster.nutrition['energy_kcal'] ?? null,
})

export const MealLogSheetProvider = ({
  children,
}: MealLogSheetProviderProps): React.JSX.Element => {
  const queryClient = useQueryClient()
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Identifies which open/edit "session" a mutation was started from. A
  // mutation's onSuccess can fire after the sheet has since been closed or
  // reopened for a different entry (the user cancels a slow delete and
  // starts a new record before it resolves) — reset() only clears the
  // mutation's own isPending/isError display state, it doesn't cancel the
  // in-flight request or suppress its onSuccess. Comparing the id captured
  // at mutate() time against the current ref stops a stale onSuccess from
  // clobbering whatever sheet is open by then.
  const sheetIdRef = useRef(0)

  const mealSetsQuery = useQuery({
    queryKey: ['meal-sets'],
    queryFn: () => toPromise(fetchMealSets()),
    enabled: sheet?.mode === 'create' && sheet.activeTab === 'meal-set',
  })

  const invalidateMealLogQueries = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['day-detail'] })
    void queryClient.invalidateQueries({ queryKey: ['foods'] })
  }

  const compositionMutation = useMutation({
    mutationFn: ({
      compositionCode,
    }: {
      compositionCode: string
      sheetId: number
    }) => toPromise(registerFoodMasterFromComposition(compositionCode)),
    onSuccess: (foodMaster, { sheetId }) => {
      if (sheetId !== sheetIdRef.current) return
      const food = toSelectedFood(foodMaster)
      setSheet((prev) =>
        prev === null
          ? prev
          : prev.mode === 'meal-set'
            ? applyMealSetFoodSelection(prev, food)
            : prev.mode === 'create'
              ? applyFoodSelection(prev, food, true)
              : prev,
      )
      void queryClient.invalidateQueries({ queryKey: ['foods'] })
    },
  })

  const saveMutation = useMutation<
    MealLogResult | ReadonlyArray<MealLogResult>,
    Error,
    SaveVariables
  >({
    mutationFn: async () => {
      if (sheet === null) {
        return Promise.reject(new Error('no food selected'))
      }
      if (sheet.mode === 'meal-set') {
        const payload = buildMealSetSavePayload(sheet)
        if (payload === null) {
          return Promise.reject(new Error('meal set is not ready to save'))
        }
        return toPromise(postMealLogs(payload))
      }

      const payload = buildSavePayload(sheet)
      if (payload === null) {
        return Promise.reject(new Error('no food selected'))
      }
      return toPromise(
        sheet.mode === 'edit'
          ? patchMealLog(sheet.mealLogId, payload)
          : postMealLog(payload),
      )
    },
    onSuccess: (_result, { continueCreating, sheetId }) => {
      if (sheetId !== sheetIdRef.current) return
      invalidateMealLogQueries()
      setSheet((prev) =>
        prev === null
          ? prev
          : continueCreating && prev.mode === 'create'
            ? buildContinueState(prev)
            : null,
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: ({ id }: { id: string; sheetId: number }) =>
      toPromise(deleteMealLog(id)),
    onSuccess: (_result, { sheetId }) => {
      if (sheetId !== sheetIdRef.current) return
      invalidateMealLogQueries()
      setConfirmingDelete(false)
      setSheet(null)
    },
  })

  const resetMutations = (): void => {
    saveMutation.reset()
    compositionMutation.reset()
    deleteMutation.reset()
  }

  const openCreate = (): void => {
    resetMutations()
    setConfirmingDelete(false)
    sheetIdRef.current += 1
    setSheet(buildCreateState())
  }

  const openEdit = (entry: DayDetailEntry): void => {
    resetMutations()
    setConfirmingDelete(false)
    sheetIdRef.current += 1
    setSheet(buildEditState(entry))
  }

  const close = (): void => {
    resetMutations()
    setConfirmingDelete(false)
    sheetIdRef.current += 1
    setSheet(null)
  }

  if (sheet === null) {
    return (
      <MealLogSheetContext.Provider value={{ openCreate, openEdit }}>
        {children}
      </MealLogSheetContext.Provider>
    )
  }

  const saveError = saveMutation.isError
    ? sheet.mode === 'meal-set' &&
      saveMutation.error instanceof BatchMealLogRequestError &&
      saveMutation.error.itemIndex !== null
      ? (() => {
          const itemIndex = saveMutation.error.itemIndex
          const item = sheet.items[itemIndex - 1]
          return item === undefined
            ? `品目 ${String(itemIndex)} の記録に失敗しました: ${saveMutation.error.message}`
            : `「${item.foodName}」の記録に失敗しました: ${saveMutation.error.message}`
        })()
      : '保存に失敗しました。入力内容を確認して再度お試しください。'
    : null

  return (
    <MealLogSheetContext.Provider value={{ openCreate, openEdit }}>
      {children}
      <MealLogSheet
        state={sheet}
        close={close}
        setQuery={(query) => {
          setSheet((prev) => (prev === null ? prev : { ...prev, query }))
        }}
        selectFood={(food) => {
          setSheet((prev) =>
            prev === null
              ? prev
              : prev.mode === 'meal-set'
                ? applyMealSetFoodSelection(prev, food)
                : prev.mode === 'create'
                  ? applyFoodSelection(prev, food, false)
                  : prev,
          )
        }}
        selectComposition={(compositionCode) => {
          compositionMutation.mutate({
            compositionCode,
            sheetId: sheetIdRef.current,
          })
        }}
        isRegisteringComposition={compositionMutation.isPending}
        compositionError={compositionMutation.isError}
        backToSearch={() => {
          setSheet((prev) =>
            prev === null
              ? prev
              : prev.mode === 'meal-set'
                ? cancelMealSetFoodSelection(prev)
                : prev.mode === 'create'
                  ? applyBackToSearch(prev)
                  : prev,
          )
        }}
        setQuantity={(quantity) => {
          setSheet((prev) =>
            prev === null || prev.mode === 'meal-set'
              ? prev
              : { ...prev, quantity },
          )
        }}
        setMealType={(mealType: MealType) => {
          setSheet((prev) => (prev === null ? prev : { ...prev, mealType }))
        }}
        setDate={(date) => {
          setSheet((prev) => (prev === null ? prev : { ...prev, date }))
        }}
        setCreateTab={(tab) => {
          setSheet((prev) =>
            prev?.mode === 'create' ? changeCreateTab(prev, tab) : prev,
          )
        }}
        mealSets={mealSetsQuery.data ?? []}
        isMealSetsLoading={mealSetsQuery.isLoading}
        mealSetsError={
          mealSetsQuery.isError
            ? 'マイセットを取得できませんでした。再度お試しください。'
            : undefined
        }
        selectMealSet={(mealSet: MealSet) => {
          setSheet((prev) =>
            prev?.mode === 'create'
              ? buildMealSetRecordState(mealSet, prev.date)
              : prev,
          )
        }}
        setMealSetItemQuantity={(itemId, quantity) => {
          setSheet((prev) =>
            prev?.mode === 'meal-set'
              ? changeMealSetItemQuantity(prev, itemId, quantity)
              : prev,
          )
        }}
        removeMealSetItem={(itemId) => {
          setSheet((prev) =>
            prev?.mode === 'meal-set'
              ? removeMealSetRecordItem(prev, itemId)
              : prev,
          )
        }}
        replaceMealSetItem={(itemId) => {
          setSheet((prev) =>
            prev?.mode === 'meal-set'
              ? beginMealSetFoodSelection(prev, { type: 'replace', itemId })
              : prev,
          )
        }}
        addMealSetItem={() => {
          setSheet((prev) =>
            prev?.mode === 'meal-set'
              ? beginMealSetFoodSelection(prev, { type: 'add' })
              : prev,
          )
        }}
        backToMealSet={() => {
          setSheet((prev) =>
            prev?.mode === 'meal-set' ? cancelMealSetFoodSelection(prev) : prev,
          )
        }}
        save={() => {
          saveMutation.mutate({
            continueCreating: false,
            sheetId: sheetIdRef.current,
          })
        }}
        saveAndContinue={() => {
          saveMutation.mutate({
            continueCreating: true,
            sheetId: sheetIdRef.current,
          })
        }}
        isSaving={saveMutation.isPending}
        saveError={saveError}
        confirmingDelete={confirmingDelete}
        requestDelete={() => {
          setConfirmingDelete(true)
        }}
        cancelDelete={() => {
          deleteMutation.reset()
          setConfirmingDelete(false)
        }}
        confirmDelete={() => {
          if (sheet.mode === 'edit') {
            deleteMutation.mutate({
              id: sheet.mealLogId,
              sheetId: sheetIdRef.current,
            })
          }
        }}
        isDeleting={deleteMutation.isPending}
        deleteError={deleteMutation.isError}
      />
    </MealLogSheetContext.Provider>
  )
}
