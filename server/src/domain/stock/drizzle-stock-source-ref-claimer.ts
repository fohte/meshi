import { err, ok } from 'neverthrow'
import { z } from 'zod'

import type { SqlOrTx } from '#db/index'
import { StockDomainError } from '#domain/stock/errors'
import { firstRow, parseRows } from '#domain/stock/stock-repository-utils'

const deliveryOwnerSchema = z.object({ delivery_id: z.string() })

export const claimDeliverySourceRef = async (
  tx: SqlOrTx,
  input: { readonly sourceRef: string; readonly deliveryId: string },
) => {
  const claimRows = parseRows(
    deliveryOwnerSchema,
    await tx<Record<string, unknown>[]>`
      INSERT INTO delivery_source_refs (source_ref, delivery_id, created_at)
      VALUES (${input.sourceRef}, ${input.deliveryId}, statement_timestamp())
      ON CONFLICT (source_ref) DO NOTHING
      RETURNING delivery_id
    `,
    'claim delivery source reference',
  )
  if (claimRows.isErr()) return err(claimRows.error)
  if (claimRows.value.length > 0) return ok(undefined)

  const ownerRows = parseRows(
    deliveryOwnerSchema,
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
        sourceRef: input.sourceRef,
        deliveryId: input.deliveryId,
        conflictingDeliveryId: owner.value.delivery_id,
      },
    ),
  )
}
