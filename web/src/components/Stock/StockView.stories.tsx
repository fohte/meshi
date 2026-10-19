import type { Meta, StoryObj } from '@storybook/react-vite'

import type { StockStatus } from '#api/stock'
import { StockView } from '#components/Stock/StockView'

const STOCK_ITEM: StockStatus['stockItems'][number] = {
  foodMasterId: 'food_example_pasta',
  foodName: '架空パスタ',
  storageLocation: { name: '乾物棚', capacity: null },
  eatWithinDays: null,
  totalQuantity: 1.5,
  lots: [
    {
      id: 'lot_example_pasta',
      quantity: 2,
      remainingQuantity: 1.5,
      receivedDate: null,
      bestBefore: '2026-11-10',
      eatBy: '2026-10-30',
    },
  ],
  storageLocationId: 'location_example_dry',
}

const BASE_DATA: StockStatus = {
  stockItems: [
    STOCK_ITEM,
    {
      foodMasterId: 'food_example_soup',
      foodName: '架空スープ',
      storageLocation: null,
      eatWithinDays: 2,
      totalQuantity: 0,
      lots: [],
      storageLocationId: null,
    },
  ],
  plannedDeliveries: [
    {
      id: 'delivery_example',
      sourceRef: 'order_example_first',
      expectedDate: '2026-10-26',
      changeDeadline: '2026-10-23',
      items: [
        {
          foodMasterId: 'food_example_pasta',
          foodName: '架空パスタ',
          quantity: 2.5,
        },
      ],
    },
    {
      id: 'delivery_example_two',
      sourceRef: 'order_example_second',
      expectedDate: '2026-10-26',
      changeDeadline: null,
      items: [
        {
          foodMasterId: 'food_example_soup',
          foodName: '架空スープ',
          quantity: 1.25,
        },
      ],
    },
  ],
  capacityWarnings: [
    {
      id: 'capacity_warning_example',
      storageLocationId: 'location_example_dry',
      storageLocationName: '乾物棚',
      expectedDate: '2026-10-26',
      deliveries: [
        {
          deliveryId: 'delivery_example',
          changeDeadline: '2026-10-23',
        },
        { deliveryId: 'delivery_example_two', changeDeadline: null },
      ],
      projectedQuantity: 6.5,
      capacity: 5,
      excessQuantity: 1.5,
    },
  ],
  eatByWarnings: [
    {
      id: 'eat_by_warning_example',
      riskType: 'deadline_passed',
      stockLotId: 'lot_example_soup',
      foodMasterId: 'food_example_soup',
      foodName: '架空スープ',
      targetDate: '2026-10-15',
      targetDateType: 'best_before',
      remainingQuantity: 0.5,
      quantityUsedForRate: null,
      daysUntilTarget: null,
      requiredDailyConsumption: null,
      actualDailyConsumption: 0.25,
    },
    {
      id: 'eat_by_warning_example_two',
      riskType: 'consumption_rate_below_required',
      stockLotId: 'lot_example_pasta',
      foodMasterId: 'food_example_pasta',
      foodName: '架空パスタ',
      targetDate: '2026-10-30',
      targetDateType: 'eat_by',
      remainingQuantity: 1.5,
      quantityUsedForRate: 0.5,
      daysUntilTarget: 10,
      requiredDailyConsumption: 0.15,
      actualDailyConsumption: 0.05,
    },
  ],
  priorityLots: [
    {
      foodMasterId: 'food_example_soup',
      foodName: '架空スープ',
      stockLotId: 'lot_example_soup',
      remainingQuantity: 0.5,
      targetDate: null,
      reasons: ['deadline_passed', 'oldest_received'],
    },
    {
      foodMasterId: 'food_example_pasta',
      foodName: '架空パスタ',
      stockLotId: 'lot_example_pasta',
      remainingQuantity: 1.5,
      targetDate: '2026-10-30',
      reasons: ['eat_by', 'consumption_rate_below_required'],
    },
  ],
}

const EMPTY_DATA: StockStatus = {
  stockItems: [],
  plannedDeliveries: [],
  capacityWarnings: [],
  eatByWarnings: [],
  priorityLots: [],
}

const CAPACITY_WARNING_DATA: StockStatus = {
  ...BASE_DATA,
  stockItems: [],
  eatByWarnings: [],
  priorityLots: [],
}

const meta: Meta<typeof StockView> = {
  title: 'components/Stock/StockView',
  component: StockView,
  args: {
    countForm: {
      foodMasterId: STOCK_ITEM.foodMasterId,
      quantity: '',
      receivedDate: '',
      bestBefore: '',
      isSaving: false,
      onFoodMasterIdChange: () => undefined,
      onQuantityChange: () => undefined,
      onReceivedDateChange: () => undefined,
      onBestBeforeChange: () => undefined,
      onSubmit: () => undefined,
    },
  },
}

export default meta

type Story = StoryObj<typeof StockView>

const noActions = {
  onRetry: () => undefined,
  onRefresh: () => undefined,
}

export const Loading: Story = {
  name: '在庫データの読み込み中です',
  args: {
    data: null,
    isLoading: true,
    isFetching: true,
    isError: false,
    ...noActions,
  },
}

export const FailedToLoad: Story = {
  name: '在庫データの取得に失敗しています',
  args: {
    data: null,
    isLoading: false,
    isFetching: false,
    isError: true,
    ...noActions,
  },
}

export const NoStockTargets: Story = {
  name: '在庫対象も入荷予定も警告もありません',
  args: {
    data: EMPTY_DATA,
    isLoading: false,
    isFetching: false,
    isError: false,
    ...noActions,
  },
}

export const WithStockAndWarnings: Story = {
  name: '残数と入荷予定と警告を表示しています',
  args: {
    data: BASE_DATA,
    isLoading: false,
    isFetching: false,
    isError: false,
    ...noActions,
  },
}

export const CapacityWarningWithMultipleDeliveries: Story = {
  name: '容量警告で複数配送の変更締切を照合しています',
  args: {
    data: CAPACITY_WARNING_DATA,
    isLoading: false,
    isFetching: false,
    isError: false,
    ...noActions,
  },
}

export const NoPlannedDeliveries: Story = {
  name: '在庫はありますが入荷予定はありません',
  args: {
    data: { ...BASE_DATA, plannedDeliveries: [], capacityWarnings: [] },
    isLoading: false,
    isFetching: false,
    isError: false,
    ...noActions,
  },
}

export const NoWarnings: Story = {
  name: '在庫と入荷予定があり警告はありません',
  args: {
    data: {
      ...BASE_DATA,
      capacityWarnings: [],
      eatByWarnings: [],
      priorityLots: [],
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    ...noActions,
  },
}

export const Refreshing: Story = {
  name: '最新の在庫を取得しています',
  args: {
    data: BASE_DATA,
    isLoading: false,
    isFetching: true,
    isError: false,
    ...noActions,
  },
}

export const RefreshFailedWithCachedData: Story = {
  name: '更新に失敗し最後に取得した在庫を表示しています',
  args: {
    data: BASE_DATA,
    isLoading: false,
    isFetching: false,
    isError: true,
    ...noActions,
  },
}
