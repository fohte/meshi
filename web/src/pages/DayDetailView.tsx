import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import {
  type DayDetailEntry,
  fetchDayDetail,
  type MealType,
} from '#api/day-detail'
import type { MealPhoto } from '#api/meal-photos'
import {
  deleteMealPhoto,
  fetchMealPhotos,
  mealPhotosQueryKey,
  uploadMealPhoto,
} from '#api/meal-photos'
import { deleteMealSkip, putMealSkip } from '#api/meal-skips'
import type { NutrientDefinition } from '#api/nutrient-definitions'
import {
  fetchNutrientDefinitions,
  NUTRIENT_DEFINITIONS_QUERY_KEY,
} from '#api/nutrient-definitions'
import { fetchUserProfile, PROFILE_QUERY_KEY } from '#api/profile'
import { toPromise } from '#api/to-promise'
import { ErrorRetry } from '#components/ErrorRetry/ErrorRetry'
import { getMealPhotoUploadErrorMessage } from '#components/MealPhotoGallery/meal-photo-upload-error-message'
import { MealPhotoGallery } from '#components/MealPhotoGallery/MealPhotoGallery'
import { buildMealTimelineGroups } from '#components/MealTimeline/build-meal-timeline-groups'
import { MealTimeline } from '#components/MealTimeline/MealTimeline'
import { buildNutritionSummaryData } from '#components/NutritionSummary/build-nutrition-summary-data'
import { NutritionSummary } from '#components/NutritionSummary/NutritionSummary'
import { Skeleton } from '#components/Skeleton/Skeleton'
import {
  formatJstMonthDay,
  shiftDateString,
  todayJstDate,
  weekdayLabelJa,
} from '#lib/jst-date'
import { useMealLogSheet } from '#meal-log-sheet/MealLogSheetContext'
import styles from '#pages/DayDetailView.module.css'

export interface DayDetailViewProps {
  readonly date: string
}

const useMealPhotoQuery = (date: string, mealType: MealType) =>
  useQuery({
    queryKey: mealPhotosQueryKey(date, mealType),
    queryFn: () => toPromise(fetchMealPhotos(date, mealType)),
  })

export const DayDetailView = ({
  date,
}: DayDetailViewProps): React.JSX.Element => {
  const dayDetailQuery = useQuery({
    queryKey: ['day-detail', date],
    queryFn: () => toPromise(fetchDayDetail(date)),
  })
  const nutrientDefinitionsQuery = useQuery({
    queryKey: NUTRIENT_DEFINITIONS_QUERY_KEY,
    queryFn: () => toPromise(fetchNutrientDefinitions()),
    staleTime: Infinity,
  })
  const profileQuery = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => toPromise(fetchUserProfile()),
  })

  const isPending =
    dayDetailQuery.isPending ||
    nutrientDefinitionsQuery.isPending ||
    profileQuery.isPending
  const isError =
    dayDetailQuery.isError ||
    nutrientDefinitionsQuery.isError ||
    profileQuery.isError

  const retry = (): void => {
    void dayDetailQuery.refetch()
    void nutrientDefinitionsQuery.refetch()
    void profileQuery.refetch()
  }

  const today = todayJstDate()
  const prevDate = shiftDateString(date, -1)
  const nextDate = shiftDateString(date, 1)
  const showNext = date < today
  const weekday = weekdayLabelJa(date)
  const monthDay = formatJstMonthDay(date)

  const crumb = `${weekday}曜日`
  const entryCount = dayDetailQuery.data?.entries.length ?? 0

  return (
    <div>
      <header className={styles.header}>
        <div>
          <div className={styles.crumb}>{crumb}</div>
          <h1 className={styles.title}>
            <span className={styles.titleMark}>#</span> {date}
          </h1>
          {!isPending && !isError && (
            <div className={styles.sub}>
              {monthDay}の記録 · {entryCount} 品
            </div>
          )}
        </div>
        <nav className={styles.nav}>
          <Link className={styles.navButton} to={`/days/${prevDate}`}>
            ← 前日
          </Link>
          {showNext && (
            <Link className={styles.navButton} to={`/days/${nextDate}`}>
              翌日 →
            </Link>
          )}
          <Link className={styles.navButton} to="/history">
            カレンダー
          </Link>
        </nav>
      </header>

      {isError && <ErrorRetry onRetry={retry} />}

      {isPending && !isError && (
        <div className={styles.skeletonStack}>
          <Skeleton height={220} />
          <Skeleton height={140} />
        </div>
      )}

      {!isPending && !isError && (
        <DayDetailContent
          date={date}
          entries={dayDetailQuery.data.entries}
          totals={dayDetailQuery.data.totals}
          incompleteNutrients={dayDetailQuery.data.incompleteNutrients}
          hasEstimatedValues={dayDetailQuery.data.hasEstimatedValues}
          hasUnknownValues={dayDetailQuery.data.hasUnknownValues}
          skippedMealTypes={dayDetailQuery.data.skippedMealTypes}
          definitions={nutrientDefinitionsQuery.data}
          targets={profileQuery.data.dailyTargets}
        />
      )}
    </div>
  )
}

interface DayDetailContentProps {
  readonly date: string
  readonly entries: ReadonlyArray<DayDetailEntry>
  readonly totals: Readonly<Record<string, number>>
  readonly incompleteNutrients: ReadonlyArray<string>
  readonly hasEstimatedValues: boolean
  readonly hasUnknownValues: boolean
  readonly skippedMealTypes: ReadonlyArray<MealType>
  readonly definitions: ReadonlyArray<NutrientDefinition>
  readonly targets: Readonly<Record<string, number>> | null
}

const DayDetailContent = ({
  date,
  entries,
  totals,
  incompleteNutrients,
  hasEstimatedValues,
  hasUnknownValues,
  skippedMealTypes,
  definitions,
  targets,
}: DayDetailContentProps): React.JSX.Element => {
  const { openEdit } = useMealLogSheet()
  const queryClient = useQueryClient()
  const [selectedPhoto, setSelectedPhoto] = useState<{
    readonly mealType: MealType
    readonly photo: MealPhoto
  } | null>(null)

  const breakfastPhotoQuery = useMealPhotoQuery(date, 'breakfast')
  const lunchPhotoQuery = useMealPhotoQuery(date, 'lunch')
  const dinnerPhotoQuery = useMealPhotoQuery(date, 'dinner')
  const snackPhotoQuery = useMealPhotoQuery(date, 'snack')
  const mealPhotoQueries = {
    breakfast: breakfastPhotoQuery,
    lunch: lunchPhotoQuery,
    dinner: dinnerPhotoQuery,
    snack: snackPhotoQuery,
  }

  const invalidateDayDetail = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['day-detail'] })
  }

  const markSkippedMutation = useMutation({
    mutationFn: (mealType: MealType) => toPromise(putMealSkip(date, mealType)),
    onSuccess: invalidateDayDetail,
  })
  const cancelSkipMutation = useMutation({
    mutationFn: (mealType: MealType) =>
      toPromise(deleteMealSkip(date, mealType)),
    onSuccess: invalidateDayDetail,
  })

  const uploadMealPhotoMutation = useMutation({
    mutationFn: ({ mealType, file }: { mealType: MealType; file: File }) =>
      toPromise(uploadMealPhoto(date, mealType, file)),
    onSuccess: (_photo, { mealType }) =>
      queryClient.invalidateQueries({
        queryKey: mealPhotosQueryKey(date, mealType),
      }),
  })
  const deleteMealPhotoMutation = useMutation({
    mutationFn: ({ id }: { id: string; mealType: MealType }) =>
      toPromise(deleteMealPhoto(id)),
    onSuccess: (_result, { mealType }) => {
      setSelectedPhoto(null)
      return queryClient.invalidateQueries({
        queryKey: mealPhotosQueryKey(date, mealType),
      })
    },
  })

  const getMealPhotoQuery = (mealType: MealType) => mealPhotoQueries[mealType]

  const renderMealPhotos = (mealType: MealType): React.JSX.Element => {
    const photoQuery = getMealPhotoQuery(mealType)
    const uploadFailedForMeal =
      uploadMealPhotoMutation.isError &&
      uploadMealPhotoMutation.variables.mealType === mealType
    const isUploadingThisMeal =
      uploadMealPhotoMutation.isPending &&
      uploadMealPhotoMutation.variables.mealType === mealType
    const previewPhoto =
      selectedPhoto?.mealType === mealType ? selectedPhoto.photo : null
    const deleteFailedForPhoto =
      deleteMealPhotoMutation.isError &&
      deleteMealPhotoMutation.variables.id === previewPhoto?.id

    return (
      <MealPhotoGallery
        photos={photoQuery.data ?? []}
        isLoading={photoQuery.isPending}
        {...(photoQuery.isError
          ? { loadError: '写真を読み込めませんでした。' }
          : {})}
        onRetry={() => {
          void photoQuery.refetch()
        }}
        isUploading={isUploadingThisMeal}
        isUploadDisabled={uploadMealPhotoMutation.isPending}
        {...(uploadFailedForMeal
          ? {
              uploadError: getMealPhotoUploadErrorMessage(
                uploadMealPhotoMutation.error,
              ),
            }
          : {})}
        previewPhoto={previewPhoto}
        isDeleting={
          deleteMealPhotoMutation.isPending &&
          deleteMealPhotoMutation.variables.id === previewPhoto?.id
        }
        {...(deleteFailedForPhoto
          ? {
              deleteError:
                '写真を削除できませんでした。もう一度お試しください。',
            }
          : {})}
        onUpload={(file) => {
          uploadMealPhotoMutation.reset()
          uploadMealPhotoMutation.mutate({ mealType, file })
        }}
        onPhotoClick={(photo) => {
          setSelectedPhoto({ mealType, photo })
        }}
        onClosePreview={() => {
          setSelectedPhoto(null)
        }}
        onDeletePhoto={(id) => {
          deleteMealPhotoMutation.reset()
          deleteMealPhotoMutation.mutate({ id, mealType })
        }}
      />
    )
  }

  return (
    <div className={styles.content}>
      <NutritionSummary
        data={buildNutritionSummaryData(
          totals,
          definitions,
          targets,
          hasUnknownValues,
          incompleteNutrients,
        )}
        hasEstimatedValues={hasEstimatedValues}
        hasUnknownValues={hasUnknownValues}
      />
      <MealTimeline
        groups={buildMealTimelineGroups(entries, skippedMealTypes)}
        renderMealPhotos={renderMealPhotos}
        onItemClick={(id) => {
          const entry = entries.find((e) => e.id === id)
          if (entry !== undefined) openEdit(entry)
        }}
        onMarkSkipped={(mealType) => {
          markSkippedMutation.mutate(mealType)
        }}
        onCancelSkip={(mealType) => {
          cancelSkipMutation.mutate(mealType)
        }}
        isSkipActionPending={
          markSkippedMutation.isPending || cancelSkipMutation.isPending
        }
      />
    </div>
  )
}
