import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  BODY_WEIGHTS_QUERY_KEY,
  type BodyWeight,
  deleteBodyWeight,
  fetchBodyWeights,
  patchBodyWeight,
  postBodyWeight,
} from '#api/body-weights'
import { toPromise } from '#api/to-promise'
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

export const HistoryBodyWeightView = (): React.JSX.Element => {
  const queryClient = useQueryClient()
  const today = todayJstDate()
  const [period, setPeriod] = useState<BodyWeightPeriod>('week')
  const [periodOffset, setPeriodOffset] = useState(0)
  const [draft, setDraft] = useState<BodyWeightDraft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [initialDate, setInitialDate] = useState<string | null>(null)
  const [initialMeasuredTime, setInitialMeasuredTime] = useState<string | null>(
    null,
  )
  const [initialMeasuredAt, setInitialMeasuredAt] = useState<string | null>(
    null,
  )
  const [deleteTarget, setDeleteTarget] = useState<BodyWeight | null>(null)

  const span = PERIOD_DAYS[period]
  const end = shiftDateString(today, periodOffset * span)
  const start = shiftDateString(end, -(span - 1))
  const query = useQuery({
    queryKey: [...BODY_WEIGHTS_QUERY_KEY, start, end],
    queryFn: () => toPromise(fetchBodyWeights(start, end)),
  })

  const resetDraft = (): void => {
    setEditingId(null)
    setInitialDate(null)
    setInitialMeasuredTime(null)
    setInitialMeasuredAt(null)
    setDraft(emptyDraft())
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

  const loadState = query.isPending
    ? 'loading'
    : query.isError
      ? 'error'
      : 'loaded'

  return (
    <BodyWeightPanel
      records={newestFirst(query.data ?? [])}
      loadState={loadState}
      loadError={query.error?.message}
      onRetry={() => {
        void query.refetch()
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
    />
  )
}
