import { z } from 'zod'

const deliveryItemInput = z
  .object({
    food_master_id: z.string().trim().min(1),
    quantity: z.number().positive(),
  })
  .strict()

const deliveryActualItemInput = z
  .object({
    food_master_id: z.string().trim().min(1),
    quantity: z.number().min(0),
  })
  .strict()

const hasUniqueFoodMasterIds = (
  items: ReadonlyArray<{ readonly food_master_id: string }>,
): boolean =>
  new Set(items.map((item) => item.food_master_id)).size === items.length

export const registerDeliveryInput = z
  .object({
    source_ref: z.string().trim().min(1).nullable().optional(),
    status: z.enum(['planned', 'cancelled']),
    expected_date: z.iso.date(),
    change_deadline: z.iso.date().nullable().optional(),
    items: z.array(deliveryItemInput).refine(hasUniqueFoodMasterIds, {
      message: 'items must not contain duplicate food_master_id values',
    }),
  })
  .strict()
  .refine((input) => input.status === 'cancelled' || input.items.length > 0, {
    message: 'planned deliveries must include at least one item',
    path: ['items'],
  })

export const receiveDeliveryInput = z
  .object({
    delivery_id: z.string().trim().min(1),
    received_date: z.iso.date(),
    items: z
      .array(deliveryActualItemInput)
      .refine(hasUniqueFoodMasterIds, {
        message: 'items must not contain duplicate food_master_id values',
      })
      .optional(),
  })
  .strict()

export const deliveryStructuredItemOutput = z.object({
  food_master_id: z.string(),
  food_name: z.string(),
  quantity: z.number(),
})

export const deliveryStructuredOutput = z.object({
  delivery_id: z.string(),
  source_ref: z.string().nullable(),
  status: z.enum(['planned', 'received', 'cancelled']),
  expected_date: z.iso.date(),
  received_date: z.iso.date().nullable(),
  change_deadline: z.iso.date().nullable(),
  items: z.array(deliveryStructuredItemOutput),
})

export const listDeliveriesInput = z
  .object({
    delivery_id: z.string().trim().min(1).optional(),
    source_ref: z.string().trim().min(1).optional(),
    status: z.enum(['planned', 'received', 'cancelled']).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict()

export const updateDeliverySourceRefInput = z
  .object({
    delivery_id: z.string().trim().min(1),
    source_ref: z.string().trim().min(1),
  })
  .strict()

const deliverySourceRefHistoryOutput = z.object({
  source_ref: z.string(),
  created_at: z.iso.datetime({ offset: true }),
})

const listedDeliveryStructuredOutput = z.object({
  delivery_id: z.string(),
  source_ref: z.string().nullable(),
  source_ref_history: z.array(deliverySourceRefHistoryOutput),
  status: z.enum(['planned', 'received', 'cancelled']),
  expected_date: z.iso.date(),
  received_date: z.iso.date().nullable(),
  change_deadline: z.iso.date().nullable(),
  items: z.array(
    z.object({
      food_master_id: z.string(),
      food_name: z.string(),
      stock_lot_id: z.string(),
      quantity: z.number(),
      remaining_quantity: z.number().nullable(),
    }),
  ),
})

export const listDeliveriesStructuredOutput = z.object({
  deliveries: z.array(listedDeliveryStructuredOutput),
})

export const updateDeliverySourceRefStructuredOutput =
  listedDeliveryStructuredOutput
