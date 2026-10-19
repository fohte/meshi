import { useState } from 'react'

import type { StockStatus } from '#api/stock'
import type {
  StockDeliveryDraft,
  StockDeliveryEditorMode,
  StockDeliveryEditorProps,
  StockDeliveryEditorViewProps,
  StockItem,
} from '#components/Stock/stock-delivery-editor-types'
import { StockDeliveryEditorView } from '#components/Stock/StockDeliveryEditorView'
import { todayJstDate } from '#lib/jst-date'

type PlannedDelivery = StockStatus['plannedDeliveries'][number]

const createDraft = (
  mode: StockDeliveryEditorMode,
  delivery: PlannedDelivery | null,
): StockDeliveryDraft => {
  const today = todayJstDate()
  return {
    sourceRef: delivery?.sourceRef ?? '',
    expectedDate: delivery?.expectedDate ?? today,
    changeDeadline: delivery?.changeDeadline ?? '',
    receivedDate: today,
    items:
      delivery?.items.map((item) => ({
        foodMasterId: item.foodMasterId,
        quantity: String(item.quantity),
      })) ?? (mode === 'create' ? [{ foodMasterId: '', quantity: '' }] : []),
  }
}

const readItems = (items: StockDeliveryDraft['items']) =>
  items.map((item) => ({
    foodMasterId: item.foodMasterId,
    quantity: Number(item.quantity),
  }))

const validateItems = (
  items: StockDeliveryDraft['items'],
  allowZero: boolean,
): boolean => {
  const seen = new Set<string>()
  return items.every((item) => {
    const quantity = Number(item.quantity)
    if (
      item.foodMasterId === '' ||
      item.quantity.trim() === '' ||
      !Number.isFinite(quantity) ||
      (allowZero ? quantity < 0 : quantity <= 0) ||
      seen.has(item.foodMasterId)
    ) {
      return false
    }
    seen.add(item.foodMasterId)
    return true
  })
}

export const StockDeliveryEditor = (
  props: StockDeliveryEditorProps & {
    readonly stockItems: ReadonlyArray<StockItem>
  },
): React.JSX.Element => {
  const {
    mode,
    delivery,
    isSubmitting,
    onClose,
    onRegister,
    onReceive,
    ...viewPropsBase
  } = props
  const [draft, setDraft] = useState(() => createDraft(mode, delivery))
  const [isConfirming, setIsConfirming] = useState(false)
  const [validationError, setValidationError] = useState<string | undefined>()

  const onDraftChange: StockDeliveryEditorViewProps['onDraftChange'] = (
    update,
  ): void => {
    setDraft((current) => ({ ...current, ...update }))
    setValidationError(undefined)
  }

  const onItemChange: StockDeliveryEditorViewProps['onItemChange'] = (
    index,
    update,
  ): void => {
    onDraftChange({
      items: draft.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...update } : item,
      ),
    })
  }

  const onConfirmationConfirm = (): void => {
    if (isSubmitting) return
    if (mode === 'cancel') {
      if (delivery?.sourceRef == null) return
      onRegister({
        sourceRef: delivery.sourceRef,
        status: 'cancelled',
        expectedDate: delivery.expectedDate,
        changeDeadline: delivery.changeDeadline,
        items: delivery.items.map(({ foodMasterId, quantity }) => ({
          foodMasterId,
          quantity,
        })),
      })
    }
    if (mode === 'receive' && delivery !== null) {
      onReceive(delivery.id, {
        receivedDate: draft.receivedDate,
        items: readItems(draft.items),
      })
    }
  }

  const onFormSubmit: StockDeliveryEditorViewProps['onFormSubmit'] = (
    event,
  ): void => {
    event.preventDefault()
    if (isSubmitting) return

    if (mode === 'receive') {
      if (delivery === null) return
      if (draft.receivedDate === '' || !validateItems(draft.items, true)) {
        setValidationError('受領日と各食品の数量を確認してください。')
        return
      }
      setIsConfirming(true)
      setValidationError(undefined)
      return
    }

    if (
      draft.sourceRef.trim() === '' ||
      draft.expectedDate === '' ||
      !validateItems(draft.items, false)
    ) {
      setValidationError(
        '注文番号、入荷予定日、各食品の数量を確認してください。',
      )
      return
    }
    onRegister({
      sourceRef: draft.sourceRef,
      status: 'planned',
      expectedDate: draft.expectedDate,
      changeDeadline: draft.changeDeadline || null,
      items: readItems(draft.items),
    })
  }

  const viewProps: StockDeliveryEditorViewProps = {
    ...viewPropsBase,
    mode,
    delivery,
    isSubmitting,
    onClose,
    draft,
    isConfirming,
    validationError,
    onDraftChange,
    onItemChange,
    onAddItem: () => {
      onDraftChange({
        items: [...draft.items, { foodMasterId: '', quantity: '' }],
      })
    },
    onRemoveItem: (index) => {
      onDraftChange({
        items: draft.items.filter((_, itemIndex) => itemIndex !== index),
      })
    },
    onFormSubmit,
    onConfirmationBack: () => {
      if (mode === 'cancel') {
        onClose()
      } else {
        setIsConfirming(false)
      }
    },
    onConfirmationConfirm,
  }

  return <StockDeliveryEditorView {...viewProps} />
}
