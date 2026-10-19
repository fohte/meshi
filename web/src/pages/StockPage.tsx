import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { fetchStockStatus, STOCK_QUERY_KEY } from '#api/stock'
import { postStockCount, type StockCountInput } from '#api/stock-counts'
import { toPromise } from '#api/to-promise'
import { StockView } from '#components/Stock/StockView'

export const StockPage = (): React.JSX.Element => {
  const queryClient = useQueryClient()
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

  return (
    <StockView
      data={stockQuery.data ?? null}
      isLoading={stockQuery.isPending && !stockQuery.isError}
      isFetching={stockQuery.isFetching}
      isError={stockQuery.isError}
      onRetry={refresh}
      onRefresh={refresh}
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
