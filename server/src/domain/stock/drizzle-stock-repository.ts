import type { Sql } from '#db/index'
import { defaultIdGenerator, type IdGenerator } from '#domain/food-master/id'
import { createStockCounter } from '#domain/stock/drizzle-stock-counter'
import { createStockDeliveryReader } from '#domain/stock/drizzle-stock-delivery-reader'
import { createStockDeliveryReceiver } from '#domain/stock/drizzle-stock-delivery-receiver'
import { createStockDeliveryWriter } from '#domain/stock/drizzle-stock-delivery-writer'
import { createStockItemWriter } from '#domain/stock/drizzle-stock-item-writer'
import { createStockLotUpdater } from '#domain/stock/drizzle-stock-lot-updater'
import { createStockStatusReader } from '#domain/stock/drizzle-stock-status-reader'
import type { StockRepository } from '#domain/stock/types'

export interface CreateStockRepositoryOptions {
  readonly generateId?: IdGenerator
  readonly wrapInTransaction?: boolean
}

export const createDrizzleStockRepository = (
  pgSql: Sql,
  options: CreateStockRepositoryOptions = {},
): StockRepository => {
  const generateId = options.generateId ?? defaultIdGenerator
  const wrapInTransaction = options.wrapInTransaction ?? true

  return {
    setStockItem: createStockItemWriter(pgSql, generateId, wrapInTransaction),
    countStock: createStockCounter(pgSql, generateId, wrapInTransaction),
    updateStockLot: createStockLotUpdater(pgSql, wrapInTransaction),
    registerDelivery: createStockDeliveryWriter(
      pgSql,
      generateId,
      wrapInTransaction,
    ),
    receiveDelivery: createStockDeliveryReceiver(
      pgSql,
      generateId,
      wrapInTransaction,
    ),
    listDeliveries: createStockDeliveryReader(pgSql),
    getStockStatus: createStockStatusReader(pgSql),
  }
}
