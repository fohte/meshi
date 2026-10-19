import { z } from 'zod'

import { requestJson } from '#api/request'

const stockLotSchema = z.strictObject({
  id: z.string(),
  quantity: z.number(),
  remainingQuantity: z.number(),
  receivedDate: z.iso.date().nullable(),
  bestBefore: z.iso.date().nullable(),
  eatBy: z.iso.date().nullable(),
})

const stockItemSchema = z.strictObject({
  foodMasterId: z.string(),
  foodName: z.string(),
  storageLocation: z
    .strictObject({
      name: z.string(),
      capacity: z.number().nullable(),
    })
    .nullable(),
  eatWithinDays: z.number().nullable(),
  totalQuantity: z.number(),
  lots: z.array(stockLotSchema),
  storageLocationId: z.string().nullable(),
})

const deliveryItemSchema = z.strictObject({
  foodMasterId: z.string(),
  foodName: z.string(),
  quantity: z.number(),
})

const plannedDeliverySchema = z.strictObject({
  id: z.string(),
  sourceRef: z.string().nullable(),
  expectedDate: z.iso.date(),
  changeDeadline: z.iso.date().nullable(),
  items: z.array(deliveryItemSchema),
})

const capacityWarningSchema = z.strictObject({
  id: z.string(),
  storageLocationId: z.string(),
  storageLocationName: z.string(),
  expectedDate: z.iso.date(),
  deliveries: z.array(
    z.strictObject({
      deliveryId: z.string(),
      changeDeadline: z.iso.date().nullable(),
    }),
  ),
  projectedQuantity: z.number(),
  capacity: z.number(),
  excessQuantity: z.number(),
})

const eatByWarningSchema = z.strictObject({
  id: z.string(),
  riskType: z.enum(['deadline_passed', 'consumption_rate_below_required']),
  stockLotId: z.string(),
  foodMasterId: z.string(),
  foodName: z.string(),
  targetDate: z.iso.date(),
  targetDateType: z.enum(['best_before', 'eat_by']),
  remainingQuantity: z.number(),
  quantityUsedForRate: z.number().nullable(),
  daysUntilTarget: z.number().nullable(),
  requiredDailyConsumption: z.number().nullable(),
  actualDailyConsumption: z.number(),
})

const priorityLotSchema = z.strictObject({
  foodMasterId: z.string(),
  foodName: z.string(),
  stockLotId: z.string(),
  remainingQuantity: z.number(),
  targetDate: z.iso.date().nullable(),
  reasons: z.array(
    z.enum([
      'best_before',
      'eat_by',
      'oldest_received',
      'deadline_passed',
      'consumption_rate_below_required',
    ]),
  ),
})

const stockStatusSchema = z.strictObject({
  stockItems: z.array(stockItemSchema),
  plannedDeliveries: z.array(plannedDeliverySchema),
  capacityWarnings: z.array(capacityWarningSchema),
  eatByWarnings: z.array(eatByWarningSchema),
  priorityLots: z.array(priorityLotSchema),
})

export type StockStatus = z.infer<typeof stockStatusSchema>

export const STOCK_QUERY_KEY = ['stock'] as const

export const fetchStockStatus = () =>
  requestJson('/api/stock', stockStatusSchema)
