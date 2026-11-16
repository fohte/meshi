import { z } from 'zod'

import { jstDateSchema } from '#lib/jst-date'

const measuredAtSchema = z.iso.datetime({ offset: true })

const BODY_FAT_DESCRIPTION = '体脂肪率 (%)。体重に占める脂肪の割合。'
const MUSCLE_MASS_DESCRIPTION =
  '筋肉量 (kg)。タニタの定義で、骨格筋・平滑筋・心筋と、それらに含まれる水分の重さ。骨格筋量 (kg) や除脂肪量ではない。'
const SKELETAL_MUSCLE_DESCRIPTION =
  '骨格筋率 (%)。体重に占める骨格筋の割合。平滑筋・心筋を含まない。骨格筋量 (kg) ではない。'
const DEVICE_DESCRIPTION =
  '測定した体組成計の機器名。利用者に確認し、以前と同じ機器なら list_body_compositions で前回の表記を確かめて揃える。'

export const BODY_COMPOSITION_GUIDANCE =
  '体脂肪率は体重に占める脂肪の割合 (%)。筋肉量はタニタの定義で、骨格筋・平滑筋・心筋とそれらに含まれる水分の重さ (kg)。骨格筋率は体重に占める骨格筋の割合 (%) で、平滑筋・心筋を含まない。体組成計の表示にある項目だけを記録し、名前の近い別指標を当てはめない。特に骨格筋量 (kg) や除脂肪量を muscle_mass_kg に入れない。機器名は利用者に確認し、前回と同じ機器なら list_body_compositions で前回の表記を確かめて揃える。体重は record_body_weight で別に記録し、同じ報告に体重があれば両方を呼ぶ。値は体組成計の推定値で真値ではない.'

export const recordBodyCompositionInput = z
  .object({
    date: jstDateSchema.describe('測定日 (JST、YYYY-MM-DD)'),
    device: z.string().describe(DEVICE_DESCRIPTION),
    measured_at: measuredAtSchema
      .optional()
      .describe(
        '利用者が伝えた測定日時 (オフセット付き ISO 8601)。不明なら省略',
      ),
    body_fat_percent: z.number().optional().describe(BODY_FAT_DESCRIPTION),
    muscle_mass_kg: z.number().optional().describe(MUSCLE_MASS_DESCRIPTION),
    skeletal_muscle_percent: z
      .number()
      .optional()
      .describe(SKELETAL_MUSCLE_DESCRIPTION),
  })
  .refine(
    ({ body_fat_percent, muscle_mass_kg, skeletal_muscle_percent }) =>
      body_fat_percent !== undefined ||
      muscle_mass_kg !== undefined ||
      skeletal_muscle_percent !== undefined,
    { message: 'at least one body composition value must be provided' },
  )

export const listBodyCompositionsInput = z
  .object({
    from: jstDateSchema.describe('期間の開始日 (JST、含む。YYYY-MM-DD)'),
    to: jstDateSchema.describe('期間の終了日 (JST、含む。YYYY-MM-DD)'),
  })
  .refine(({ from, to }) => from <= to, {
    message: 'from must be on or before to',
  })

export const updateBodyCompositionInput = z
  .object({
    body_composition_id: z.string().min(1).describe('訂正する体組成記録の ID'),
    date: jstDateSchema.optional().describe('測定日 (JST、YYYY-MM-DD)'),
    measured_at: measuredAtSchema
      .nullable()
      .optional()
      .describe('測定日時。null を指定すると時刻を消す'),
    device: z.string().optional().describe(DEVICE_DESCRIPTION),
    body_fat_percent: z
      .number()
      .nullable()
      .optional()
      .describe(`${BODY_FAT_DESCRIPTION} null を指定すると値を消す。`),
    muscle_mass_kg: z
      .number()
      .nullable()
      .optional()
      .describe(`${MUSCLE_MASS_DESCRIPTION} null を指定すると値を消す。`),
    skeletal_muscle_percent: z
      .number()
      .nullable()
      .optional()
      .describe(`${SKELETAL_MUSCLE_DESCRIPTION} null を指定すると値を消す。`),
  })
  .refine(
    ({ body_composition_id, ...fields }) =>
      body_composition_id.length > 0 &&
      Object.values(fields).some((value) => value !== undefined),
    { message: 'at least one body composition field must be provided' },
  )

export const deleteBodyCompositionInput = z.object({
  body_composition_id: z.string().min(1).describe('削除する体組成記録の ID'),
})

const bodyCompositionOutput = z.object({
  body_composition_id: z.string(),
  date: jstDateSchema,
  measured_at: z.iso.datetime({ offset: true }).nullable(),
  device: z.string(),
  body_fat_percent: z.number().nullable(),
  muscle_mass_kg: z.number().nullable(),
  skeletal_muscle_percent: z.number().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
})

const bodyCompositionErrorOutput = z.object({
  code: z.string(),
  message: z.string(),
})

export const recordBodyCompositionStructuredOutput = bodyCompositionOutput
  .partial()
  .extend({ error: bodyCompositionErrorOutput.optional() })

export const listBodyCompositionsStructuredOutput = z.object({
  body_compositions: z.array(bodyCompositionOutput).optional(),
  error: bodyCompositionErrorOutput.optional(),
})

export const updateBodyCompositionStructuredOutput = bodyCompositionOutput
  .partial()
  .extend({ error: bodyCompositionErrorOutput.optional() })

export const deleteBodyCompositionStructuredOutput = z.object({
  body_composition_id: z.string().optional(),
  error: bodyCompositionErrorOutput.optional(),
})
