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
