import { z } from 'zod'

import { jstDateSchema } from '#lib/jst-date'
import { measuredAtSchema } from '#mcp-tools/measured-at-schema'

export const recordBodyWeightInput = z.object({
  date: jstDateSchema.describe('測定日 (JST、YYYY-MM-DD)'),
  weight_kg: z.number().describe('体重 (kg)'),
  measured_at: measuredAtSchema
    .optional()
    .describe('利用者が伝えた測定日時 (オフセット付き ISO 8601)。不明なら省略'),
})

export const listBodyWeightsInput = z
  .object({
    from: jstDateSchema.describe('期間の開始日 (JST、含む。YYYY-MM-DD)'),
    to: jstDateSchema.describe('期間の終了日 (JST、含む。YYYY-MM-DD)'),
  })
  .refine(({ from, to }) => from <= to, {
    message: 'from must be on or before to',
  })

export const updateBodyWeightInput = z
  .object({
    body_weight_id: z.string().min(1).describe('訂正する体重記録の ID'),
    date: jstDateSchema.optional().describe('測定日 (JST、YYYY-MM-DD)'),
    weight_kg: z.number().optional().describe('体重 (kg)'),
    measured_at: measuredAtSchema
      .nullable()
      .optional()
      .describe('測定日時。null を指定すると時刻を消す'),
  })
  .refine(
    ({ date, weight_kg, measured_at }) =>
      date !== undefined ||
      weight_kg !== undefined ||
      measured_at !== undefined,
    { message: 'at least one body weight field must be provided' },
  )

export const deleteBodyWeightInput = z.object({
  body_weight_id: z.string().min(1).describe('削除する体重記録の ID'),
})

const bodyWeightOutput = z.object({
  body_weight_id: z.string(),
  date: jstDateSchema,
  measured_at: z.iso.datetime({ offset: true }).nullable(),
  weight_kg: z.number(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
})

const bodyWeightErrorOutput = z.object({
  code: z.string(),
  message: z.string(),
})

export const recordBodyWeightStructuredOutput = bodyWeightOutput
  .partial()
  .extend({ error: bodyWeightErrorOutput.optional() })

export const listBodyWeightsStructuredOutput = z.object({
  body_weights: z.array(bodyWeightOutput).optional(),
  error: bodyWeightErrorOutput.optional(),
})

export const updateBodyWeightStructuredOutput = bodyWeightOutput
  .partial()
  .extend({ error: bodyWeightErrorOutput.optional() })

export const deleteBodyWeightStructuredOutput = z.object({
  body_weight_id: z.string().optional(),
  error: bodyWeightErrorOutput.optional(),
})
