import { z } from 'zod'

import { numericString } from '#domain/stock/stock-repository-utils'
import type { StockItem } from '#domain/stock/types'

export const stockItemRowSchema = z.object({
  food_master_id: z.string(),
  food_name: z.string(),
  storage_location_name: z.string().nullable(),
  storage_location_capacity: numericString.nullable(),
  eat_within_days: z.number().int().nullable(),
})

export const toStockItem = (
  row: z.output<typeof stockItemRowSchema>,
): StockItem => ({
  foodMasterId: row.food_master_id,
  foodName: row.food_name,
  storageLocation:
    row.storage_location_name === null
      ? null
      : {
          name: row.storage_location_name,
          capacity: row.storage_location_capacity,
        },
  eatWithinDays: row.eat_within_days,
})
