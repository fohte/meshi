import { z } from 'zod'

import { parseJson } from '#lib/json'
import {
  type AgentInvokeMessage,
  findTurnMessages,
} from '#llm/agent/derive-reply'

// The register_food_master(_from_composition) tools only export a plain TS
// output type, not a zod schema — these validate that tool result's JSON
// content locally.
// basis_quantity/basis_unit are optional: a tool result that omits them was
// registered at the implicit 100g/1g basis, so defaulting to (100, 'g')
// below reflects that basis rather than an arbitrary fallback.
const registerFoodMasterOutputSchema = z.object({
  food_master_id: z.string(),
  name: z.string(),
  source: z.enum(['web_search', 'user_input']),
  source_url: z.string().nullable(),
  nutrition_per_100g: z.record(z.string(), z.number()),
  basis_quantity: z.number().optional(),
  basis_unit: z.string().optional(),
})

const registerFoodMasterFromCompositionOutputSchema = z.object({
  food_master_id: z.string(),
  name: z.string(),
  composition_code: z.string(),
  composition_name: z.string(),
  nutrition_per_100g: z.record(z.string(), z.number()),
  basis_quantity: z.number().optional(),
  basis_unit: z.string().optional(),
})

const REGISTER_FOOD_MASTER_TOOL_NAME = 'register_food_master'
const REGISTER_FOOD_MASTER_FROM_COMPOSITION_TOOL_NAME =
  'register_food_master_from_composition'

const formatNumber = (n: number): string => {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(1)
}

export interface RegisteredFoodMasterDisclosure {
  readonly name: string
  readonly energyKcalPerBasis: number | null
  readonly basisQuantity: number
  readonly basisUnit: string
  readonly sourceLabel: string
}

// Collects every register_food_master / register_food_master_from_composition
// tool result from this turn (in turn order, not just the latest — one turn
// can register several foods with fabricated-looking nutrition unless the
// evidence backing each is disclosed), so the LLM's own reply text is never
// the only account of what evidence a newly registered food's numbers rest
// on. Scoped to findTurnMessages the same way extractLatestMealHistoryOutput
// is, so an earlier turn's registration can't leak into a later reply.
export const extractRegisteredFoodMasters = (
  messages: ReadonlyArray<AgentInvokeMessage> | undefined,
): ReadonlyArray<RegisteredFoodMasterDisclosure> => {
  const turnMessages = findTurnMessages(messages)
  const disclosures: RegisteredFoodMasterDisclosure[] = []

  for (const message of turnMessages) {
    if (message.getType() !== 'tool' || typeof message.content !== 'string') {
      continue
    }

    if (message.name === REGISTER_FOOD_MASTER_TOOL_NAME) {
      const json = parseJson(message.content)
      if (json.isErr()) continue
      const parsed = registerFoodMasterOutputSchema.safeParse(json.value)
      if (!parsed.success) continue
      disclosures.push({
        name: parsed.data.name,
        energyKcalPerBasis:
          parsed.data.nutrition_per_100g['energy_kcal'] ?? null,
        basisQuantity: parsed.data.basis_quantity ?? 100,
        basisUnit: parsed.data.basis_unit ?? 'g',
        sourceLabel:
          parsed.data.source === 'web_search'
            ? `${parsed.data.source_url ?? ''} (web検索)`
            : 'あなたの申告値',
      })
      continue
    }

    if (message.name === REGISTER_FOOD_MASTER_FROM_COMPOSITION_TOOL_NAME) {
      const json = parseJson(message.content)
      if (json.isErr()) continue
      const parsed = registerFoodMasterFromCompositionOutputSchema.safeParse(
        json.value,
      )
      if (!parsed.success) continue
      disclosures.push({
        name: parsed.data.name,
        energyKcalPerBasis:
          parsed.data.nutrition_per_100g['energy_kcal'] ?? null,
        basisQuantity: parsed.data.basis_quantity ?? 100,
        basisUnit: parsed.data.basis_unit ?? 'g',
        sourceLabel: `成分表「${parsed.data.composition_name}」(コード ${parsed.data.composition_code})`,
      })
    }
  }

  return disclosures
}

// Appends a deterministic disclosure block for every food registered this
// turn, mirroring withItemizedMealHistory's append style — the actual
// evidence behind a newly registered food's numbers never depends on the
// LLM choosing to mention it.
export const withRegisteredFoodMasterDisclosure = (
  message: string,
  disclosures: ReadonlyArray<RegisteredFoodMasterDisclosure>,
): string => {
  if (disclosures.length === 0) return message

  const lines = ['新しく登録した食品:']
  for (const d of disclosures) {
    const kcalSuffix =
      d.energyKcalPerBasis === null
        ? ''
        : ` ${formatNumber(d.energyKcalPerBasis)}kcal/${formatNumber(d.basisQuantity)}${d.basisUnit}`
    lines.push(`- ${d.name}${kcalSuffix}`)
    lines.push(`  出典: ${d.sourceLabel}`)
  }
  lines.push('値が違う場合は教えてください。')

  return `${message}\n\n${lines.join('\n')}`
}
