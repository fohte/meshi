import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { fetchStockStatus, STOCK_QUERY_KEY, type StockStatus } from '#api/stock'
import { postStockCount, type StockCountInput } from '#api/stock-counts'
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
  const queryClient = useQueryClient()
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
  const [foodMasterId, setFoodMasterId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [receivedDate, setReceivedDate] = useState('')
  const [bestBefore, setBestBefore] = useState('')
  const countMutation = useMutation({
    mutationFn: (input: StockCountInput) => toPromise(postStockCount(input)),
    onSuccess: async () => {
      setQuantity('')
      setReceivedDate('')
      setBestBefore('')
      await queryClient.invalidateQueries({ queryKey: STOCK_QUERY_KEY })
    },
  })

  const stockItems = stockQuery.data?.stockItems ?? []
  const selectedFoodMasterId = stockItems.some(
    (item) => item.foodMasterId === foodMasterId,
  )
    ? foodMasterId
    : (stockItems[0]?.foodMasterId ?? '')

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
      countForm={{
        foodMasterId: selectedFoodMasterId,
        quantity,
        receivedDate,
        bestBefore,
        isSaving: countMutation.isPending,
        ...(countMutation.error === null
          ? {}
          : { error: countMutation.error.message }),
        onFoodMasterIdChange: (value) => {
          countMutation.reset()
          setFoodMasterId(value)
        },
        onQuantityChange: (value) => {
          countMutation.reset()
          setQuantity(value)
        },
        onReceivedDateChange: (value) => {
          countMutation.reset()
          setReceivedDate(value)
        },
        onBestBeforeChange: (value) => {
          countMutation.reset()
          setBestBefore(value)
        },
        onSubmit: (input) => {
          countMutation.mutate(input)
        },
      }}
    />
  )
}
