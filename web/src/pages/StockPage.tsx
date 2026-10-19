import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { fetchStockStatus, STOCK_QUERY_KEY, type StockStatus } from '#api/stock'
import {
  receiveStockDelivery,
  type ReceiveStockDeliveryInput,
  registerStockDelivery,
  type RegisterStockDeliveryInput,
  StockDeliveryRequestError,
} from '#api/stock-deliveries'
import { toPromise } from '#api/to-promise'
import type { StockDeliveryEditorMode } from '#components/Stock/stock-delivery-editor-types'
import { StockView } from '#components/Stock/StockView'

type PlannedDelivery = StockStatus['plannedDeliveries'][number]

interface DeliveryEditorState {
  readonly mode: StockDeliveryEditorMode
  readonly delivery: PlannedDelivery | null
}

export const StockPage = (): React.JSX.Element => {
  const [deliveryEditor, setDeliveryEditor] =
    useState<DeliveryEditorState | null>(null)
  const [isSubmittingDelivery, setIsSubmittingDelivery] = useState(false)
  const [deliveryError, setDeliveryError] = useState<string | undefined>()
  const deliverySubmissionPending = useRef(false)
  const stockQuery = useQuery({
    queryKey: STOCK_QUERY_KEY,
    queryFn: () => toPromise(fetchStockStatus()),
    refetchOnMount: 'always',
  })

  const refresh = (): void => {
    void stockQuery.refetch()
  }

  const openDeliveryEditor = (
    mode: StockDeliveryEditorMode,
    delivery: PlannedDelivery | null = null,
  ): void => {
    setDeliveryError(undefined)
    setDeliveryEditor({ mode, delivery })
  }

  const submitDeliveryRequest = async (
    request: () => ReturnType<typeof registerStockDelivery>,
  ): Promise<void> => {
    if (deliverySubmissionPending.current) return
    deliverySubmissionPending.current = true
    setIsSubmittingDelivery(true)
    setDeliveryError(undefined)

    const result = await request()
    if (result.isOk()) {
      setDeliveryEditor(null)
      setDeliveryError(undefined)
      await stockQuery.refetch()
    } else {
      setDeliveryError(result.error.message)
      if (
        result.error instanceof StockDeliveryRequestError &&
        result.error.status === 409
      ) {
        await stockQuery.refetch()
      }
    }

    deliverySubmissionPending.current = false
    setIsSubmittingDelivery(false)
  }

  const handleRegisterDelivery = (input: RegisterStockDeliveryInput): void => {
    void submitDeliveryRequest(() => registerStockDelivery(input))
  }

  const handleReceiveDelivery = (
    deliveryId: string,
    input: ReceiveStockDeliveryInput,
  ): void => {
    void submitDeliveryRequest(() => receiveStockDelivery(deliveryId, input))
  }

  const editorProps =
    deliveryEditor === null
      ? null
      : {
          ...deliveryEditor,
          isSubmitting: isSubmittingDelivery,
          error: deliveryError,
          onClose: () => {
            if (!deliverySubmissionPending.current) setDeliveryEditor(null)
          },
          onRegister: handleRegisterDelivery,
          onReceive: handleReceiveDelivery,
        }

  return (
    <StockView
      data={stockQuery.data ?? null}
      isLoading={stockQuery.isPending && !stockQuery.isError}
      isFetching={stockQuery.isFetching}
      isError={stockQuery.isError}
      onRetry={refresh}
      onRefresh={refresh}
      deliveryEditor={editorProps}
      onCreateDelivery={() => {
        openDeliveryEditor('create')
      }}
      onEditDelivery={(delivery) => {
        openDeliveryEditor('edit', delivery)
      }}
      onCancelDelivery={(delivery) => {
        openDeliveryEditor('cancel', delivery)
      }}
      onReceiveDelivery={(delivery) => {
        openDeliveryEditor('receive', delivery)
      }}
    />
  )
}
