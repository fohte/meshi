import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import {
  BODY_COMPOSITIONS_QUERY_KEY,
  type BodyComposition,
  deleteBodyComposition,
  fetchBodyCompositions,
  patchBodyComposition,
  postBodyComposition,
} from '#api/body-compositions'
import {
  BODY_WEIGHTS_QUERY_KEY,
  type BodyWeight,
  deleteBodyWeight,
  fetchBodyWeights,
  patchBodyWeight,
  postBodyWeight,
} from '#api/body-weights'
import { toPromise } from '#api/to-promise'
import { type BodyCompositionDraft } from '#components/BodyCompositionForm/BodyCompositionForm'
import {
  type BodyWeightDraft,
  BodyWeightPanel,
  type BodyWeightPeriod,
} from '#components/BodyWeightPanel/BodyWeightPanel'
import { shiftDateString, todayJstDate } from '#lib/jst-date'

const PERIOD_DAYS: Record<BodyWeightPeriod, number> = { week: 7, month: 30 }

const emptyDraft = (): BodyWeightDraft => ({
  date: todayJstDate(),
  weightKg: '',
  measuredTime: '',
})

const emptyCompositionDraft = (device = ''): BodyCompositionDraft => ({
  date: todayJstDate(),
  measuredTime: '',
  device,
  bodyFatPercent: '',
  muscleMassKg: '',
  skeletalMusclePercent: '',
})

const toJstTime = (measuredAt: string | null): string => {
  if (measuredAt === null) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(measuredAt))
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00'
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00'
  return `${hour}:${minute}`
}

const toJstSecondAndMillisecond = (measuredAt: string): string => {
  const instant = new Date(measuredAt)
  const second =
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tokyo',
      second: '2-digit',
    })
      .formatToParts(instant)
      .find((part) => part.type === 'second')?.value ?? '00'
  const millisecond = instant.getUTCMilliseconds()
  return millisecond === 0
    ? second
    : `${second}.${String(millisecond).padStart(3, '0')}`
}

const newestFirst = (records: ReadonlyArray<BodyWeight>): BodyWeight[] =>
  [...records].sort((left, right) => {
    const dateOrder = right.date.localeCompare(left.date)
    if (dateOrder !== 0) return dateOrder
    if (left.measuredAt === null) return right.measuredAt === null ? 0 : 1
    if (right.measuredAt === null) return -1
    return right.measuredAt.localeCompare(left.measuredAt)
  })

const newestCompositionsFirst = (
  records: ReadonlyArray<BodyComposition>,
): BodyComposition[] =>
  [...records].sort((left, right) => {
    const dateOrder = right.date.localeCompare(left.date)
    if (dateOrder !== 0) return dateOrder
    if (left.measuredAt === null) return right.measuredAt === null ? 0 : 1
    if (right.measuredAt === null) return -1
    return right.measuredAt.localeCompare(left.measuredAt)
  })

const parseOptionalNumber = (value: string): number | null =>
  value === '' ? null : Number(value)

export const HistoryBodyWeightView = (): React.JSX.Element => {
  const queryClient = useQueryClient()
  const today = todayJstDate()
  const [period, setPeriod] = useState<BodyWeightPeriod>('week')
  const [periodOffset, setPeriodOffset] = useState(0)
  const [draft, setDraft] = useState<BodyWeightDraft>(emptyDraft)
  const [compositionDraft, setCompositionDraft] =
    useState<BodyCompositionDraft>(() => emptyCompositionDraft())
  const [hasInitializedCompositionDevice, setHasInitializedCompositionDevice] =
    useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [compositionEditingId, setCompositionEditingId] = useState<
    string | null
  >(null)
  const [initialDate, setInitialDate] = useState<string | null>(null)
  const [initialMeasuredTime, setInitialMeasuredTime] = useState<string | null>(
    null,
  )
  const [initialMeasuredAt, setInitialMeasuredAt] = useState<string | null>(
    null,
  )
  const [compositionInitialDate, setCompositionInitialDate] = useState<
    string | null
  >(null)
  const [compositionInitialMeasuredTime, setCompositionInitialMeasuredTime] =
    useState<string | null>(null)
  const [compositionInitialMeasuredAt, setCompositionInitialMeasuredAt] =
    useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BodyWeight | null>(null)
  const [compositionDeleteTarget, setCompositionDeleteTarget] =
    useState<BodyComposition | null>(null)

  const span = PERIOD_DAYS[period]
  const end = shiftDateString(today, periodOffset * span)
  const start = shiftDateString(end, -(span - 1))
  const query = useQuery({
    queryKey: [...BODY_WEIGHTS_QUERY_KEY, start, end],
    queryFn: () => toPromise(fetchBodyWeights(start, end)),
  })
  const compositionQuery = useQuery({
    queryKey: [...BODY_COMPOSITIONS_QUERY_KEY, start, end],
    queryFn: () => toPromise(fetchBodyCompositions(start, end)),
  })
  const compositionRecords = newestCompositionsFirst(
    compositionQuery.data ?? [],
  )
  const latestDevice = compositionRecords[0]?.device

  useEffect(() => {
    if (compositionQuery.isPending || hasInitializedCompositionDevice) return
    if (latestDevice !== undefined) {
      setCompositionDraft((current) =>
        current.device === '' ? { ...current, device: latestDevice } : current,
      )
    }
    setHasInitializedCompositionDevice(true)
  }, [
    compositionQuery.isPending,
    hasInitializedCompositionDevice,
    latestDevice,
  ])

  const resetDraft = (): void => {
    setEditingId(null)
    setInitialDate(null)
    setInitialMeasuredTime(null)
    setInitialMeasuredAt(null)
    setDraft(emptyDraft())
  }

  const resetCompositionDraft = (): void => {
    setCompositionEditingId(null)
    setCompositionInitialDate(null)
    setCompositionInitialMeasuredTime(null)
    setCompositionInitialMeasuredAt(null)
    setCompositionDraft(emptyCompositionDraft(latestDevice ?? ''))
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const weightKg = Number(draft.weightKg)
      const seconds =
        editingId !== null &&
        draft.measuredTime === initialMeasuredTime &&
        initialMeasuredAt !== null
          ? toJstSecondAndMillisecond(initialMeasuredAt)
          : '00'
      const measuredAt =
        draft.measuredTime === ''
          ? null
          : `${draft.date}T${draft.measuredTime}:${seconds}+09:00`
      if (editingId !== null) {
        const shouldUpdateMeasuredAt =
          draft.date !== initialDate ||
          draft.measuredTime !== initialMeasuredTime
        return toPromise(
          patchBodyWeight(editingId, {
            date: draft.date,
            weightKg,
            ...(shouldUpdateMeasuredAt ? { measuredAt } : {}),
          }),
        )
      }
      return toPromise(
        postBodyWeight({
          date: draft.date,
          weightKg,
          ...(measuredAt === null ? {} : { measuredAt }),
        }),
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BODY_WEIGHTS_QUERY_KEY })
      resetDraft()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => toPromise(deleteBodyWeight(id)),
    onSuccess: async (_record, id) => {
      await queryClient.invalidateQueries({ queryKey: BODY_WEIGHTS_QUERY_KEY })
      setDeleteTarget(null)
      if (editingId === id) resetDraft()
    },
  })

  const compositionSaveMutation = useMutation({
    mutationFn: () => {
      const seconds =
        compositionEditingId !== null &&
        compositionDraft.measuredTime === compositionInitialMeasuredTime &&
        compositionInitialMeasuredAt !== null
          ? toJstSecondAndMillisecond(compositionInitialMeasuredAt)
          : '00'
      const measuredAt =
        compositionDraft.measuredTime === ''
          ? null
          : `${compositionDraft.date}T${compositionDraft.measuredTime}:${seconds}+09:00`
      const bodyFatPercent = parseOptionalNumber(
        compositionDraft.bodyFatPercent,
      )
      const muscleMassKg = parseOptionalNumber(compositionDraft.muscleMassKg)
      const skeletalMusclePercent = parseOptionalNumber(
        compositionDraft.skeletalMusclePercent,
      )
      if (compositionEditingId !== null) {
        const shouldUpdateMeasuredAt =
          compositionDraft.date !== compositionInitialDate ||
          compositionDraft.measuredTime !== compositionInitialMeasuredTime
        return toPromise(
          patchBodyComposition(compositionEditingId, {
            date: compositionDraft.date,
            device: compositionDraft.device,
            ...(shouldUpdateMeasuredAt ? { measuredAt } : {}),
            bodyFatPercent,
            muscleMassKg,
            skeletalMusclePercent,
          }),
        )
      }
      return toPromise(
        postBodyComposition({
          date: compositionDraft.date,
          device: compositionDraft.device,
          ...(measuredAt === null ? {} : { measuredAt }),
          ...(bodyFatPercent === null ? {} : { bodyFatPercent }),
          ...(muscleMassKg === null ? {} : { muscleMassKg }),
          ...(skeletalMusclePercent === null ? {} : { skeletalMusclePercent }),
        }),
      )
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: BODY_COMPOSITIONS_QUERY_KEY,
      })
      resetCompositionDraft()
    },
  })

  const compositionDeleteMutation = useMutation({
    mutationFn: (id: string) => toPromise(deleteBodyComposition(id)),
    onSuccess: async (_record, id) => {
      await queryClient.invalidateQueries({
        queryKey: BODY_COMPOSITIONS_QUERY_KEY,
      })
      setCompositionDeleteTarget(null)
      if (compositionEditingId === id) resetCompositionDraft()
    },
  })

  const changePeriod = (next: BodyWeightPeriod): void => {
    setPeriod(next)
    setPeriodOffset(0)
  }

  const edit = (record: BodyWeight): void => {
    saveMutation.reset()
    const measuredTime = toJstTime(record.measuredAt)
    setEditingId(record.id)
    setInitialDate(record.date)
    setInitialMeasuredTime(measuredTime)
    setInitialMeasuredAt(record.measuredAt)
    setDraft({
      date: record.date,
      weightKg: String(record.weightKg),
      measuredTime,
    })
  }

  const editComposition = (record: BodyComposition): void => {
    compositionSaveMutation.reset()
    const measuredTime = toJstTime(record.measuredAt)
    setCompositionEditingId(record.id)
    setCompositionInitialDate(record.date)
    setCompositionInitialMeasuredTime(measuredTime)
    setCompositionInitialMeasuredAt(record.measuredAt)
    setCompositionDraft({
      date: record.date,
      measuredTime,
      device: record.device,
      bodyFatPercent:
        record.bodyFatPercent === null ? '' : String(record.bodyFatPercent),
      muscleMassKg:
        record.muscleMassKg === null ? '' : String(record.muscleMassKg),
      skeletalMusclePercent:
        record.skeletalMusclePercent === null
          ? ''
          : String(record.skeletalMusclePercent),
    })
  }

  const loadState =
    query.isPending || compositionQuery.isPending
      ? 'loading'
      : query.isError || compositionQuery.isError
        ? 'error'
        : 'loaded'

  return (
    <BodyWeightPanel
      records={newestFirst(query.data ?? [])}
      compositionRecords={compositionRecords}
      loadState={loadState}
      loadError={query.error?.message ?? compositionQuery.error?.message}
      onRetry={() => {
        void query.refetch()
        void compositionQuery.refetch()
      }}
      period={period}
      rangeLabel={`${start} – ${end}`}
      canGoForward={periodOffset < 0}
      onPeriodChange={changePeriod}
      onPreviousPeriod={() => {
        setPeriodOffset((offset) => offset - 1)
      }}
      onNextPeriod={() => {
        setPeriodOffset((offset) => Math.min(0, offset + 1))
      }}
      draft={draft}
      editingId={editingId}
      onDraftChange={(nextDraft) => {
        setDraft(nextDraft)
        saveMutation.reset()
      }}
      onSave={() => {
        saveMutation.mutate()
      }}
      onCancelEdit={resetDraft}
      saveError={saveMutation.error?.message}
      isSaving={saveMutation.isPending}
      deleteTarget={deleteTarget}
      onRequestDelete={(record) => {
        deleteMutation.reset()
        setDeleteTarget(record)
      }}
      onCancelDelete={() => {
        setDeleteTarget(null)
        deleteMutation.reset()
      }}
      onConfirmDelete={() => {
        if (deleteTarget !== null) deleteMutation.mutate(deleteTarget.id)
      }}
      deleteError={deleteMutation.error?.message}
      isDeleting={deleteMutation.isPending}
      onEdit={edit}
      compositionDraft={compositionDraft}
      compositionEditingId={compositionEditingId}
      onCompositionDraftChange={(nextDraft) => {
        setCompositionDraft(nextDraft)
        compositionSaveMutation.reset()
      }}
      onCompositionSave={() => {
        compositionSaveMutation.mutate()
      }}
      onCancelCompositionEdit={resetCompositionDraft}
      compositionSaveError={compositionSaveMutation.error?.message}
      isSavingComposition={compositionSaveMutation.isPending}
      compositionDeleteTarget={compositionDeleteTarget}
      onRequestCompositionDelete={(record) => {
        compositionDeleteMutation.reset()
        setCompositionDeleteTarget(record)
      }}
      onCancelCompositionDelete={() => {
        setCompositionDeleteTarget(null)
        compositionDeleteMutation.reset()
      }}
      onConfirmCompositionDelete={() => {
        if (compositionDeleteTarget !== null) {
          compositionDeleteMutation.mutate(compositionDeleteTarget.id)
        }
      }}
      compositionDeleteError={compositionDeleteMutation.error?.message}
      isDeletingComposition={compositionDeleteMutation.isPending}
      onEditComposition={editComposition}
    />
  )
}
