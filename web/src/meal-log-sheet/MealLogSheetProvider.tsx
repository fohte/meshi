import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

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
}

const toSelectedFood = (foodMaster: RegisteredFoodMaster): SelectedFood => ({
  foodMasterId: foodMaster.id,
  name: foodMaster.name,
  isEstimated: foodMaster.isEstimated,
  energyKcalPer100g: foodMaster.nutritionPer100g['energy_kcal'] ?? null,
})

export const MealLogSheetProvider = ({
  children,
}: MealLogSheetProviderProps): React.JSX.Element => {
  const queryClient = useQueryClient()
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const invalidateMealLogQueries = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['day-detail'] })
    void queryClient.invalidateQueries({ queryKey: ['foods'] })
  }

  const compositionMutation = useMutation({
    mutationFn: (compositionCode: string) =>
      toPromise(registerFoodMasterFromComposition(compositionCode)),
    onSuccess: (foodMaster) => {
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
    onSuccess: (_result, { continueCreating }) => {
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
    mutationFn: (id: string) => toPromise(deleteMealLog(id)),
    onSuccess: () => {
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
    setSheet(buildCreateState())
  }

  const openEdit = (entry: DayDetailEntry): void => {
    resetMutations()
    setConfirmingDelete(false)
    setSheet(buildEditState(entry))
  }

  const close = (): void => {
    resetMutations()
    setConfirmingDelete(false)
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
          compositionMutation.mutate(compositionCode)
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
        setNote={(note) => {
          patchSheet({ note })
        }}
        save={() => {
          saveMutation.mutate({ continueCreating: false })
        }}
        saveAndContinue={() => {
          saveMutation.mutate({ continueCreating: true })
        }}
        isSaving={saveMutation.isPending}
        saveError={saveMutation.isError}
        confirmingDelete={confirmingDelete}
        requestDelete={() => {
          setConfirmingDelete(true)
        }}
        cancelDelete={() => {
          setConfirmingDelete(false)
        }}
        confirmDelete={() => {
          if (sheet.mealLogId !== null) deleteMutation.mutate(sheet.mealLogId)
        }}
        isDeleting={deleteMutation.isPending}
        deleteError={deleteMutation.isError}
      />
    </MealLogSheetContext.Provider>
  )
}
