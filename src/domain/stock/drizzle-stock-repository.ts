import type { Sql } from '#db/index'
import { defaultIdGenerator, type IdGenerator } from '#domain/food-master/id'
import { createStockCounter } from '#domain/stock/drizzle-stock-counter'
import { createStockItemWriter } from '#domain/stock/drizzle-stock-item-writer'
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
    getStockStatus: createStockStatusReader(pgSql),
  }
}
