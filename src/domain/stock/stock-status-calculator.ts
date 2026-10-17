import type {
  CapacityWarning,
  EatByWarning,
  EatByWarningRiskType,
  PriorityLot,
  StockStatus,
  StockStatusSnapshot,
  TargetDateType,
} from '#domain/stock/types'
import type { JstDate } from '#lib/jst-date'

const CONSUMPTION_WINDOW_DAYS = 14
const WARNING_WINDOW_DAYS = 3
const RATE_COMPARISON_TOLERANCE = 0.000001

type StockStatusItem = StockStatusSnapshot['stockItems'][number]
type StockLot = StockStatusItem['lots'][number]
type LotTarget = { readonly date: string; readonly type: TargetDateType }

interface AssessedLot {
  readonly item: StockStatusItem
  readonly lot: StockLot
  readonly target: LotTarget | null
  readonly daysUntilTarget: number | null
  readonly quantityUsedForRate: number | null
  readonly requiredDailyConsumption: number | null
  readonly actualDailyConsumption: number
  readonly risk: EatByWarningRiskType | null
}

const daysBetween = (from: string, to: string): number => {
  const fromMilliseconds = Date.parse(`${from}T00:00:00.000Z`)
  const toMilliseconds = Date.parse(`${to}T00:00:00.000Z`)
  return Math.round((toMilliseconds - fromMilliseconds) / 86_400_000)
}

const effectiveArrivalDate = (expectedDate: string, today: JstDate): string =>
  expectedDate < today ? today : expectedDate

const roundRate = (rate: number): number =>
  Math.round((rate + Number.EPSILON) * 100) / 100

const getTargetDate = (lot: StockLot): LotTarget | null => {
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

const assessLots = (
  snapshot: StockStatusSnapshot,
  today: JstDate,
  dailyConsumptionByFood: ReadonlyMap<string, number>,
): AssessedLot[] =>
  snapshot.stockItems.flatMap((item) => {
    const actualDailyConsumption =
      dailyConsumptionByFood.get(item.foodMasterId) ?? 0
    const datedLots = item.lots
      .filter((lot) => lot.remainingQuantity > 0)
      .flatMap((lot) => {
        const target = getTargetDate(lot)
        return target === null ? [] : [{ lot, target }]
      })
      .sort(
        (left, right) =>
          left.target.date.localeCompare(right.target.date) ||
          left.lot.id.localeCompare(right.lot.id),
      )
    const undatedLots = item.lots.filter(
      (lot) => lot.remainingQuantity > 0 && getTargetDate(lot) === null,
    )

    let cumulativeRemainingQuantity = 0
    const assessments: AssessedLot[] = []
    for (let index = 0; index < datedLots.length;) {
      const targetDate = datedLots[index]?.target.date
      if (targetDate === undefined) break

      const targetGroup: { lot: StockLot; target: LotTarget }[] = []
      while (datedLots[index]?.target.date === targetDate) {
        const datedLot = datedLots[index]
        if (datedLot !== undefined) targetGroup.push(datedLot)
        index += 1
      }

      const daysUntilTarget = daysBetween(today, targetDate)
      const isPastTarget = daysUntilTarget < 0
      if (!isPastTarget) {
        cumulativeRemainingQuantity += targetGroup.reduce(
          (total, { lot }) => total + lot.remainingQuantity,
          0,
        )
      }
      const quantityUsedForRate = isPastTarget
        ? null
        : cumulativeRemainingQuantity
      const requiredDailyConsumption = isPastTarget
        ? null
        : cumulativeRemainingQuantity / Math.max(1, daysUntilTarget)
      const risk: EatByWarningRiskType | null = isPastTarget
        ? 'deadline_passed'
        : daysUntilTarget <= WARNING_WINDOW_DAYS &&
            requiredDailyConsumption !== null &&
            actualDailyConsumption + RATE_COMPARISON_TOLERANCE <
              requiredDailyConsumption
          ? 'consumption_rate_below_required'
          : null

      for (const { lot, target } of targetGroup) {
        assessments.push({
          item,
          lot,
          target,
          daysUntilTarget: isPastTarget ? null : daysUntilTarget,
          quantityUsedForRate,
          requiredDailyConsumption,
          actualDailyConsumption,
          risk,
        })
      }
    }

    return [
      ...assessments,
      ...undatedLots.map((lot) => ({
        item,
        lot,
        target: null,
        daysUntilTarget: null,
        quantityUsedForRate: null,
        requiredDailyConsumption: null,
        actualDailyConsumption,
        risk: null,
      })),
    ]
  })

const projectLocationQuantityAtDate = (
  snapshot: StockStatusSnapshot,
  stockItemsByFood: ReadonlyMap<string, StockStatusItem>,
  locationItems: ReadonlyArray<StockStatusItem>,
  locationId: string,
  targetDate: string,
  today: JstDate,
  dailyConsumptionByFood: ReadonlyMap<string, number>,
): number => {
  const quantitiesByFood = new Map(
    locationItems.map((item) => [item.foodMasterId, item.totalQuantity]),
  )
  const arrivalsByDate = new Map<string, Map<string, number>>()

  for (const delivery of snapshot.plannedDeliveries) {
    const arrivalDate = effectiveArrivalDate(delivery.expectedDate, today)
    if (arrivalDate > targetDate) continue

    for (const item of delivery.items) {
      const stockItem = stockItemsByFood.get(item.foodMasterId)
      if (stockItem?.storageLocationId !== locationId) continue

      const arrivals =
        arrivalsByDate.get(arrivalDate) ?? new Map<string, number>()
      arrivals.set(
        item.foodMasterId,
        (arrivals.get(item.foodMasterId) ?? 0) + item.quantity,
      )
      arrivalsByDate.set(arrivalDate, arrivals)
    }
  }

  let previousDate: string = today
  for (const arrivalDate of [...arrivalsByDate.keys()].sort()) {
    const daysSincePreviousArrival = daysBetween(previousDate, arrivalDate)
    for (const [foodMasterId, quantity] of quantitiesByFood) {
      const dailyConsumption = dailyConsumptionByFood.get(foodMasterId) ?? 0
      quantitiesByFood.set(
        foodMasterId,
        Math.max(0, quantity - dailyConsumption * daysSincePreviousArrival),
      )
    }

    for (const [foodMasterId, quantity] of arrivalsByDate.get(arrivalDate) ??
      []) {
      quantitiesByFood.set(
        foodMasterId,
        (quantitiesByFood.get(foodMasterId) ?? 0) + quantity,
      )
    }
    previousDate = arrivalDate
  }

  return [...quantitiesByFood.values()].reduce(
    (total, quantity) => total + quantity,
    0,
  )
}

interface CapacityWarningGroup {
  readonly storageLocationId: string
  readonly storageLocationName: string
  readonly forecastDate: string
  readonly groupKey: string
  readonly capacity: number
  readonly deliveries: Map<
    string,
    { readonly deliveryId: string; readonly changeDeadline: string | null }
  >
}

const calculateCapacityWarnings = (
  snapshot: StockStatusSnapshot,
  today: JstDate,
  dailyConsumptionByFood: ReadonlyMap<string, number>,
): CapacityWarning[] => {
  const stockItemsByFood = new Map(
    snapshot.stockItems.map((item) => [item.foodMasterId, item]),
  )
  const stockItemsByLocation = new Map<string, StockStatusItem[]>()
  for (const item of snapshot.stockItems) {
    if (item.storageLocationId === null) continue
    const locationItems = stockItemsByLocation.get(item.storageLocationId) ?? []
    locationItems.push(item)
    stockItemsByLocation.set(item.storageLocationId, locationItems)
  }

  const groupsByLocation = new Map<string, Map<string, CapacityWarningGroup>>()
  for (const delivery of snapshot.plannedDeliveries) {
    const forecastDate = effectiveArrivalDate(delivery.expectedDate, today)
    if (daysBetween(today, forecastDate) > WARNING_WINDOW_DAYS) continue
    const groupKey = forecastDate === today ? 'due' : forecastDate

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
      const location = locationItems[0]?.storageLocation
      const capacity = location?.capacity
      if (
        location === null ||
        location === undefined ||
        capacity === null ||
        capacity === undefined
      ) {
        continue
      }

      const datesForLocation =
        groupsByLocation.get(locationId) ??
        new Map<string, CapacityWarningGroup>()
      const group = datesForLocation.get(groupKey) ?? {
        storageLocationId: locationId,
        storageLocationName: location.name,
        forecastDate,
        groupKey,
        capacity,
        deliveries: new Map(),
      }
      group.deliveries.set(delivery.id, {
        deliveryId: delivery.id,
        changeDeadline: delivery.changeDeadline,
      })
      datesForLocation.set(groupKey, group)
      groupsByLocation.set(locationId, datesForLocation)
    }
  }

  const warnings: CapacityWarning[] = []
  for (const [locationId, datesForLocation] of groupsByLocation) {
    const locationItems = stockItemsByLocation.get(locationId) ?? []
    for (const group of datesForLocation.values()) {
      const projectedQuantity = projectLocationQuantityAtDate(
        snapshot,
        stockItemsByFood,
        locationItems,
        locationId,
        group.forecastDate,
        today,
        dailyConsumptionByFood,
      )
      if (projectedQuantity <= group.capacity) continue

      warnings.push({
        id: ['capacity-overflow', group.storageLocationId, group.groupKey].join(
          ':',
        ),
        storageLocationId: group.storageLocationId,
        storageLocationName: group.storageLocationName,
        expectedDate: group.forecastDate,
        deliveries: [...group.deliveries.values()].sort((left, right) =>
          left.deliveryId.localeCompare(right.deliveryId),
        ),
        projectedQuantity,
        capacity: group.capacity,
        excessQuantity: projectedQuantity - group.capacity,
      })
    }
  }

  return warnings.sort(
    (left, right) =>
      left.expectedDate.localeCompare(right.expectedDate) ||
      left.storageLocationName.localeCompare(right.storageLocationName) ||
      left.storageLocationId.localeCompare(right.storageLocationId),
  )
}

const calculateEatByWarnings = (
  assessedLots: ReadonlyArray<AssessedLot>,
): EatByWarning[] =>
  assessedLots
    .flatMap((assessment) => {
      if (assessment.target === null || assessment.risk === null) return []

      return [
        {
          id: [
            'eat-by-risk',
            assessment.lot.id,
            assessment.target.date,
            assessment.risk,
          ].join(':'),
          riskType: assessment.risk,
          stockLotId: assessment.lot.id,
          foodMasterId: assessment.item.foodMasterId,
          foodName: assessment.item.foodName,
          targetDate: assessment.target.date,
          targetDateType: assessment.target.type,
          remainingQuantity: assessment.lot.remainingQuantity,
          quantityUsedForRate: assessment.quantityUsedForRate,
          daysUntilTarget: assessment.daysUntilTarget,
          requiredDailyConsumption:
            assessment.requiredDailyConsumption === null
              ? null
              : roundRate(assessment.requiredDailyConsumption),
          actualDailyConsumption: roundRate(assessment.actualDailyConsumption),
        },
      ]
    })
    .sort(
      (left, right) =>
        left.targetDate.localeCompare(right.targetDate) ||
        left.foodName.localeCompare(right.foodName) ||
        left.stockLotId.localeCompare(right.stockLotId),
    )

const calculatePriorityLots = (
  assessedLots: ReadonlyArray<AssessedLot>,
): PriorityLot[] =>
  assessedLots
    .flatMap((assessment) => {
      const reasons: PriorityLot['reasons'][number][] = [
        assessment.target?.type ?? 'oldest_received',
      ]
      if (assessment.risk !== null) reasons.push(assessment.risk)

      return [
        {
          assessment,
          lot: {
            foodMasterId: assessment.item.foodMasterId,
            foodName: assessment.item.foodName,
            stockLotId: assessment.lot.id,
            remainingQuantity: assessment.lot.remainingQuantity,
            targetDate: assessment.target?.date ?? null,
            reasons,
          },
        },
      ]
    })
    .sort((left, right) => {
      const leftUndated = left.assessment.target === null
      const rightUndated = right.assessment.target === null
      const leftPaceRisk = left.lot.reasons.includes(
        'consumption_rate_below_required',
      )
      const rightPaceRisk = right.lot.reasons.includes(
        'consumption_rate_below_required',
      )
      return (
        Number(leftUndated) - Number(rightUndated) ||
        (left.lot.targetDate ?? '').localeCompare(right.lot.targetDate ?? '') ||
        Number(rightPaceRisk) - Number(leftPaceRisk) ||
        (left.assessment.lot.receivedDate ?? '').localeCompare(
          right.assessment.lot.receivedDate ?? '',
        ) ||
        left.lot.foodName.localeCompare(right.lot.foodName) ||
        left.lot.stockLotId.localeCompare(right.lot.stockLotId)
      )
    })
    .map(({ lot }) => lot)

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
  const assessedLots = assessLots(snapshot, today, dailyConsumptionByFood)

  return {
    stockItems: snapshot.stockItems,
    plannedDeliveries: snapshot.plannedDeliveries,
    capacityWarnings: calculateCapacityWarnings(
      snapshot,
      today,
      dailyConsumptionByFood,
    ),
    eatByWarnings: calculateEatByWarnings(assessedLots),
    priorityLots: calculatePriorityLots(assessedLots),
  }
}
