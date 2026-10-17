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
})
