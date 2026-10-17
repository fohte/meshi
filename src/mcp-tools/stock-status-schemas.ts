import { z } from 'zod'

import { deliveryStructuredItemOutput } from '#mcp-tools/delivery-schemas'

export const getStockStatusInput = z.object({}).strict()

export const stockStorageLocationOutput = z.object({
  name: z.string(),
  capacity: z.number().nullable(),
})

export const getStockStatusStructuredOutput = z.object({
  stock_items: z.array(
    z.object({
      food_master_id: z.string(),
      food_name: z.string(),
      total_quantity: z.number(),
      storage_location: stockStorageLocationOutput.nullable(),
      eat_within_days: z.number().int().nullable(),
      lots: z.array(
        z.object({
          stock_lot_id: z.string(),
          quantity: z.number(),
          remaining_quantity: z.number(),
          received_date: z.iso.date().nullable(),
          best_before: z.iso.date().nullable(),
          eat_by: z.iso.date().nullable(),
        }),
      ),
    }),
  ),
  planned_deliveries: z.array(
    z.object({
      delivery_id: z.string(),
      source_ref: z.string().nullable(),
      expected_date: z.iso.date(),
      change_deadline: z.iso.date().nullable(),
      items: z.array(deliveryStructuredItemOutput),
    }),
  ),
  capacity_warnings: z.array(
    z.object({
      id: z.string(),
      storage_location_id: z.string(),
      storage_location_name: z.string(),
      delivery_id: z.string(),
      source_ref: z.string().nullable(),
      expected_date: z.iso.date(),
      change_deadline: z.iso.date().nullable(),
      projected_quantity: z.number(),
      capacity: z.number(),
      excess_quantity: z.number(),
    }),
  ),
  eat_by_warnings: z.array(
    z.object({
      id: z.string(),
      stock_lot_id: z.string(),
      food_master_id: z.string(),
      food_name: z.string(),
      target_date: z.iso.date(),
      target_date_type: z.enum(['best_before', 'eat_by']),
      remaining_quantity: z.number(),
      required_daily_consumption: z.number(),
      actual_daily_consumption: z.number(),
    }),
  ),
  priority_lots: z.array(
    z.object({
      food_master_id: z.string(),
      food_name: z.string(),
      stock_lot_id: z.string(),
      remaining_quantity: z.number(),
      target_date: z.iso.date(),
      reasons: z.array(
        z.enum([
          'best_before',
          'eat_by',
          'oldest_received',
          'deadline_passed',
          'consumption_rate_below_required',
        ]),
      ),
    }),
  ),
})
