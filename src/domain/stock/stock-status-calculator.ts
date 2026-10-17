import type {
  CapacityWarning,
  EatByWarning,
  PriorityLot,
  StockStatus,
  StockStatusSnapshot,
} from '#domain/stock/types'
import type { JstDate } from '#lib/jst-date'

const CONSUMPTION_WINDOW_DAYS = 14
const WARNING_WINDOW_DAYS = 3

const daysBetween = (from: string, to: string): number => {
  const fromMilliseconds = Date.parse(`${from}T00:00:00.000Z`)
  const toMilliseconds = Date.parse(`${to}T00:00:00.000Z`)
  return Math.round((toMilliseconds - fromMilliseconds) / 86_400_000)
}

const getTargetDate = (
  lot: StockStatusSnapshot['stockItems'][number]['lots'][number],
): {
  readonly date: string
  readonly type: 'best_before' | 'eat_by'
} | null => {
  if (lot.bestBefore !== null && lot.eatBy !== null) {
    return lot.bestBefore < lot.eatBy
      ? { date: lot.bestBefore, type: 'best_before' }
      : { date: lot.eatBy, type: 'eat_by' }
  }
  if (lot.bestBefore !== null)
    return { date: lot.bestBefore, type: 'best_before' }
  if (lot.eatBy !== null) return { date: lot.eatBy, type: 'eat_by' }
  return null
}

const calculateCapacityWarnings = (
  snapshot: StockStatusSnapshot,
  today: JstDate,
  dailyConsumptionByFood: ReadonlyMap<string, number>,
): CapacityWarning[] => {
  const stockItemsByFood = new Map(
    snapshot.stockItems.map((item) => [item.foodMasterId, item]),
  )
  const stockItemsByLocation = new Map<string, typeof snapshot.stockItems>()
  for (const item of snapshot.stockItems) {
    if (item.storageLocationId === null) continue
    const locationItems = stockItemsByLocation.get(item.storageLocationId) ?? []
    stockItemsByLocation.set(item.storageLocationId, [...locationItems, item])
  }

  const warnings: CapacityWarning[] = []
  for (const delivery of snapshot.plannedDeliveries) {
    const daysUntilDelivery = daysBetween(today, delivery.expectedDate)
    if (daysUntilDelivery < 0 || daysUntilDelivery > WARNING_WINDOW_DAYS) {
      continue
    }

    const locationIds = new Set(
      delivery.items.flatMap((item) => {
        const stockItem = stockItemsByFood.get(item.foodMasterId)
        return stockItem?.storageLocationId === null || stockItem === undefined
          ? []
          : [stockItem.storageLocationId]
      }),
    )

    for (const locationId of locationIds) {
      const locationItems = stockItemsByLocation.get(locationId) ?? []
      const firstLocationItem = locationItems[0]
      const location = firstLocationItem?.storageLocation
      const capacity = location?.capacity
      if (
        location === null ||
        location === undefined ||
        capacity === null ||
        capacity === undefined
      ) {
        continue
      }

      const currentQuantity = locationItems.reduce(
        (total, item) => total + item.totalQuantity,
        0,
      )
      const dailyConsumption = locationItems.reduce(
        (total, item) =>
          total + (dailyConsumptionByFood.get(item.foodMasterId) ?? 0),
        0,
      )
      const plannedQuantity = snapshot.plannedDeliveries
        .filter(
          (plannedDelivery) =>
            plannedDelivery.expectedDate >= today &&
            plannedDelivery.expectedDate <= delivery.expectedDate,
        )
        .flatMap((plannedDelivery) => plannedDelivery.items)
        .reduce((total, item) => {
          const stockItem = stockItemsByFood.get(item.foodMasterId)
          return stockItem?.storageLocationId === locationId
            ? total + item.quantity
            : total
        }, 0)
      const projectedQuantity =
        currentQuantity + plannedQuantity - dailyConsumption * daysUntilDelivery

      if (projectedQuantity <= capacity) continue

      warnings.push({
        id: `capacity-overflow:${delivery.id}:${locationId}`,
        storageLocationId: locationId,
        storageLocationName: location.name,
        deliveryId: delivery.id,
        sourceRef: delivery.sourceRef,
        expectedDate: delivery.expectedDate,
        changeDeadline: delivery.changeDeadline,
        projectedQuantity,
        capacity,
        excessQuantity: projectedQuantity - capacity,
      })
    }
  }

  return warnings.sort(
    (left, right) =>
      left.expectedDate.localeCompare(right.expectedDate) ||
      left.storageLocationName.localeCompare(right.storageLocationName) ||
      left.deliveryId.localeCompare(right.deliveryId),
  )
}

const calculateEatByWarnings = (
  snapshot: StockStatusSnapshot,
  today: JstDate,
  dailyConsumptionByFood: ReadonlyMap<string, number>,
): EatByWarning[] =>
  snapshot.stockItems
    .flatMap((item) =>
      item.lots.flatMap((lot) => {
        const target = getTargetDate(lot)
        if (target === null) return []

        const daysUntilTarget = daysBetween(today, target.date)
        if (daysUntilTarget > WARNING_WINDOW_DAYS) return []

        const actualDailyConsumption =
          dailyConsumptionByFood.get(item.foodMasterId) ?? 0
        const requiredDailyConsumption =
          lot.remainingQuantity / Math.max(1, daysUntilTarget)
        if (
          daysUntilTarget >= 0 &&
          actualDailyConsumption >= requiredDailyConsumption
        ) {
          return []
        }

        return [
          {
            id: `eat-by-risk:${lot.id}`,
            stockLotId: lot.id,
            foodMasterId: item.foodMasterId,
            foodName: item.foodName,
            targetDate: target.date,
            targetDateType: target.type,
            remainingQuantity: lot.remainingQuantity,
            requiredDailyConsumption,
            actualDailyConsumption,
          },
        ]
      }),
    )
    .sort(
      (left, right) =>
        left.targetDate.localeCompare(right.targetDate) ||
        left.foodName.localeCompare(right.foodName) ||
        left.stockLotId.localeCompare(right.stockLotId),
    )

const calculatePriorityLots = (
  snapshot: StockStatusSnapshot,
  today: JstDate,
  dailyConsumptionByFood: ReadonlyMap<string, number>,
): PriorityLot[] =>
  snapshot.stockItems
    .flatMap((item) =>
      item.lots.flatMap((lot) => {
        if (lot.remainingQuantity <= 0) return []

        const target = getTargetDate(lot)
        const targetDate = target?.date ?? lot.receivedDate
        if (targetDate === null) return []

        const daysUntilTarget = daysBetween(today, targetDate)
        const requiredDailyConsumption =
          lot.remainingQuantity / Math.max(1, daysUntilTarget)
        const actualDailyConsumption =
          dailyConsumptionByFood.get(item.foodMasterId) ?? 0
        const reasons: PriorityLot['reasons'][number][] = [
          target?.type ?? 'oldest_received',
          ...(daysUntilTarget < 0
            ? ['deadline_passed' as const]
            : daysUntilTarget <= WARNING_WINDOW_DAYS &&
                actualDailyConsumption < requiredDailyConsumption
              ? ['consumption_rate_below_required' as const]
              : []),
        ]

        return [
          {
            foodMasterId: item.foodMasterId,
            foodName: item.foodName,
            stockLotId: lot.id,
            remainingQuantity: lot.remainingQuantity,
            targetDate,
            reasons,
          },
        ]
      }),
    )
    .sort((left, right) => {
      const leftPaceRisk = left.reasons.includes(
        'consumption_rate_below_required',
      )
      const rightPaceRisk = right.reasons.includes(
        'consumption_rate_below_required',
      )
      return (
        left.targetDate.localeCompare(right.targetDate) ||
        Number(rightPaceRisk) - Number(leftPaceRisk) ||
        left.foodName.localeCompare(right.foodName) ||
        left.stockLotId.localeCompare(right.stockLotId)
      )
    })

export const calculateStockStatus = (
  snapshot: StockStatusSnapshot,
  today: JstDate,
): StockStatus => {
  const dailyConsumptionByFood = new Map(
    snapshot.recentConsumption.map(({ foodMasterId, quantity }) => [
      foodMasterId,
      quantity / CONSUMPTION_WINDOW_DAYS,
    ]),
  )

  return {
    stockItems: snapshot.stockItems,
    plannedDeliveries: snapshot.plannedDeliveries,
    capacityWarnings: calculateCapacityWarnings(
      snapshot,
      today,
      dailyConsumptionByFood,
    ),
    eatByWarnings: calculateEatByWarnings(
      snapshot,
      today,
      dailyConsumptionByFood,
    ),
    priorityLots: calculatePriorityLots(
      snapshot,
      today,
      dailyConsumptionByFood,
    ),
  }
}
