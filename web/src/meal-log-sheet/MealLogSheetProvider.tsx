import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import type { DayDetailEntry, MealType } from '#api/day-detail'
import type { RegisteredFoodMaster } from '#api/food-masters'
import { registerFoodMasterFromComposition } from '#api/food-masters'
import {
  deleteMealLog,
  type MealLogResult,
  patchMealLog,
  postMealLog,
} from '#api/meal-logs'
import { toPromise } from '#api/to-promise'
import { MealLogSheet } from '#meal-log-sheet/MealLogSheet'
import { MealLogSheetContext } from '#meal-log-sheet/MealLogSheetContext'
import {
  applyFoodSelection,
  backToSearch as applyBackToSearch,
  buildContinueState,
  buildCreateState,
  buildEditState,
  buildSavePayload,
  type SelectedFood,
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
  energyKcalPer100g: foodMaster.nutritionPerBasis['energy_kcal'] ?? null,
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
        prev === null ? prev : applyFoodSelection(prev, food, true),
      )
      void queryClient.invalidateQueries({ queryKey: ['foods'] })
    },
  })

  const saveMutation = useMutation<MealLogResult, Error, SaveVariables>({
    mutationFn: async () => {
      const payload = sheet === null ? null : buildSavePayload(sheet)
      if (sheet === null || payload === null) {
        return Promise.reject(new Error('no food selected'))
      }
      return toPromise(
        sheet.mode === 'edit' && sheet.mealLogId !== null
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
          : continueCreating
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

  const patchSheet = (patch: Partial<SheetState>): void => {
    setSheet((prev) => (prev === null ? prev : { ...prev, ...patch }))
  }

  if (sheet === null) {
    return (
      <MealLogSheetContext.Provider value={{ openCreate, openEdit }}>
        {children}
      </MealLogSheetContext.Provider>
    )
  }

  return (
    <MealLogSheetContext.Provider value={{ openCreate, openEdit }}>
      {children}
      <MealLogSheet
        state={sheet}
        close={close}
        setQuery={(query) => {
          patchSheet({ query })
        }}
        selectFood={(food) => {
          setSheet((prev) =>
            prev === null ? prev : applyFoodSelection(prev, food, false),
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
          setSheet((prev) => (prev === null ? prev : applyBackToSearch(prev)))
        }}
        setQuantity={(quantity) => {
          patchSheet({ quantity })
        }}
        setUnit={(unit) => {
          patchSheet({ unit })
        }}
        setMealType={(mealType: MealType) => {
          patchSheet({ mealType })
        }}
        setDate={(date) => {
          patchSheet({ date })
        }}
        setTime={(time) => {
          patchSheet({ time, mealType: null })
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
        saveError={saveMutation.isError}
        confirmingDelete={confirmingDelete}
        requestDelete={() => {
          setConfirmingDelete(true)
        }}
        cancelDelete={() => {
          deleteMutation.reset()
          setConfirmingDelete(false)
        }}
        confirmDelete={() => {
          if (sheet.mealLogId !== null) {
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
