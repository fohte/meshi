import { err, ok } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import { readListedDeliveries } from '#domain/stock/drizzle-stock-delivery-reader'
import { StockDomainError } from '#domain/stock/errors'
import {
  createStockWriteRunner,
  firstRow,
  parseRows,
} from '#domain/stock/stock-repository-utils'
import type { UpdateDeliverySourceRefInput } from '#domain/stock/types'

const lockedDeliverySchema = z.object({
  id: z.string(),
  source_ref: z.string().nullable(),
})

const sourceRefOwnerSchema = z.object({ delivery_id: z.string() })

export const createStockDeliverySourceRefUpdater = (
  pgSql: Sql,
  wrapInTransaction: boolean,
) => {
  const runWrite = createStockWriteRunner(pgSql, wrapInTransaction)

  return (input: UpdateDeliverySourceRefInput) =>
    runWrite(async (tx) => {
      const lockedRows = parseRows(
        lockedDeliverySchema,
        await tx<Record<string, unknown>[]>`
          SELECT id, source_ref
          FROM deliveries
          WHERE id = ${input.deliveryId}
          FOR UPDATE
        `,
        'lock delivery for source reference update',
      )
      if (lockedRows.isErr()) return err(lockedRows.error)
      const delivery = lockedRows.value[0]
      if (delivery === undefined) {
        return err(
          new StockDomainError(
            'delivery_not_found',
            `delivery not found: ${input.deliveryId}`,
            { deliveryId: input.deliveryId },
          ),
        )
      }

      if (delivery.source_ref === input.sourceRef) {
        const listedDeliveries = await readListedDeliveries(tx, {
          deliveryId: delivery.id,
          limit: 1,
        })
        if (listedDeliveries.isErr()) return err(listedDeliveries.error)
        return firstRow(listedDeliveries.value, 'read unchanged delivery')
      }

      const claimRows = parseRows(
        sourceRefOwnerSchema,
        await tx<Record<string, unknown>[]>`
          INSERT INTO delivery_source_refs (source_ref, delivery_id, created_at)
          VALUES (${input.sourceRef}, ${delivery.id}, statement_timestamp())
          ON CONFLICT (source_ref) DO NOTHING
          RETURNING delivery_id
        `,
        'claim delivery source reference',
      )
      if (claimRows.isErr()) return err(claimRows.error)
      if (claimRows.value.length === 0) {
        const ownerRows = parseRows(
          sourceRefOwnerSchema,
          await tx<Record<string, unknown>[]>`
            SELECT delivery_id
            FROM delivery_source_refs
            WHERE source_ref = ${input.sourceRef}
          `,
          'load source reference owner',
        )
        if (ownerRows.isErr()) return err(ownerRows.error)
        const owner = firstRow(ownerRows.value, 'load source reference owner')
        if (owner.isErr()) return err(owner.error)
        return err(
          new StockDomainError(
            'delivery_source_ref_conflict',
            `source_ref is already used by delivery ${owner.value.delivery_id}`,
            {
              deliveryId: delivery.id,
              sourceRef: input.sourceRef,
              conflictingDeliveryId: owner.value.delivery_id,
            },
          ),
        )
      }

      const updatedRows = parseRows(
        z.object({ id: z.string() }),
        await tx<Record<string, unknown>[]>`
          UPDATE deliveries
          SET source_ref = ${input.sourceRef}
          WHERE id = ${delivery.id}
          RETURNING id
        `,
        'update delivery source reference',
      )
      if (updatedRows.isErr()) return err(updatedRows.error)
      const updated = firstRow(
        updatedRows.value,
        'update delivery source reference',
      )
      if (updated.isErr()) return err(updated.error)

      const listedDeliveries = await readListedDeliveries(tx, {
        deliveryId: updated.value.id,
        limit: 1,
      })
      if (listedDeliveries.isErr()) return err(listedDeliveries.error)
      const listedDelivery = firstRow(
        listedDeliveries.value,
        'read updated delivery',
      )
      return listedDelivery.isErr()
        ? err(listedDelivery.error)
        : ok(listedDelivery.value)
    })
}
