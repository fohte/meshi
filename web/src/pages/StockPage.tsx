import { useQuery } from '@tanstack/react-query'

import { fetchStockStatus, STOCK_QUERY_KEY } from '#api/stock'
import { toPromise } from '#api/to-promise'
import { StockView } from '#components/Stock/StockView'

export const StockPage = (): React.JSX.Element => {
  const stockQuery = useQuery({
    queryKey: STOCK_QUERY_KEY,
    queryFn: () => toPromise(fetchStockStatus()),
    refetchOnMount: 'always',
  })

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
    />
  )
}
