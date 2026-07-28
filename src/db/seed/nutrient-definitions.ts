import type { Sql, SqlOrTx } from '#db/index'
import { nutrientDefinitions, nutrientUnitEnum } from '#db/schema'

export type NutrientUnit = (typeof nutrientUnitEnum.enumValues)[number]

export type NutrientDefinitionSeed = typeof nutrientDefinitions.$inferInsert

interface NutrientSeedInput {
  readonly code: string
  readonly displayName: string
  readonly unit: NutrientUnit
}

// The single source of truth for which nutrient codes exist: NutrientCode /
// NUTRIENT_CODES below are derived from these two arrays, so adding an entry
// here automatically flows through to the zod schema every LLM tool exposes
// and to the DB seed.
const major = [
  { code: 'energy_kcal', displayName: 'エネルギー', unit: 'kcal' },
  { code: 'protein_g', displayName: 'たんぱく質', unit: 'g' },
  { code: 'fat_g', displayName: '脂質', unit: 'g' },
  { code: 'carb_g', displayName: '炭水化物', unit: 'g' },
  { code: 'dietary_fiber_g', displayName: '食物繊維', unit: 'g' },
  { code: 'salt_g', displayName: '食塩相当量', unit: 'g' },
] as const satisfies ReadonlyArray<NutrientSeedInput>

const minor = [
  { code: 'saturated_fat_g', displayName: '飽和脂肪酸', unit: 'g' },
  { code: 'cholesterol_mg', displayName: 'コレステロール', unit: 'mg' },
  { code: 'sodium_mg', displayName: 'ナトリウム', unit: 'mg' },
  { code: 'potassium_mg', displayName: 'カリウム', unit: 'mg' },
  { code: 'calcium_mg', displayName: 'カルシウム', unit: 'mg' },
  { code: 'magnesium_mg', displayName: 'マグネシウム', unit: 'mg' },
  { code: 'phosphorus_mg', displayName: 'リン', unit: 'mg' },
  { code: 'iron_mg', displayName: '鉄', unit: 'mg' },
  { code: 'zinc_mg', displayName: '亜鉛', unit: 'mg' },
  { code: 'copper_mg', displayName: '銅', unit: 'mg' },
  { code: 'vitamin_a_µg', displayName: 'ビタミン A', unit: 'µg' },
  { code: 'vitamin_d_µg', displayName: 'ビタミン D', unit: 'µg' },
  { code: 'vitamin_e_mg', displayName: 'ビタミン E', unit: 'mg' },
  { code: 'vitamin_k_µg', displayName: 'ビタミン K', unit: 'µg' },
  { code: 'vitamin_b1_mg', displayName: 'ビタミン B1', unit: 'mg' },
  { code: 'vitamin_b2_mg', displayName: 'ビタミン B2', unit: 'mg' },
  { code: 'niacin_mg', displayName: 'ナイアシン', unit: 'mg' },
  { code: 'vitamin_b6_mg', displayName: 'ビタミン B6', unit: 'mg' },
  { code: 'vitamin_b12_µg', displayName: 'ビタミン B12', unit: 'µg' },
  { code: 'folate_µg', displayName: '葉酸', unit: 'µg' },
  { code: 'pantothenic_acid_mg', displayName: 'パントテン酸', unit: 'mg' },
  { code: 'biotin_µg', displayName: 'ビオチン', unit: 'µg' },
  { code: 'vitamin_c_mg', displayName: 'ビタミン C', unit: 'mg' },
] as const satisfies ReadonlyArray<NutrientSeedInput>

export type NutrientCode =
  (typeof major)[number]['code'] | (typeof minor)[number]['code']

export const NUTRIENT_CODES: ReadonlyArray<NutrientCode> = [
  ...major.map((d) => d.code),
  ...minor.map((d) => d.code),
]

const withOrder = (
  entries: ReadonlyArray<NutrientSeedInput>,
  isMajor: boolean,
): ReadonlyArray<NutrientDefinitionSeed> =>
  entries.map((entry, index) => ({ ...entry, isMajor, sortOrder: index + 1 }))

export const MAJOR_NUTRIENT_DEFINITIONS: ReadonlyArray<NutrientDefinitionSeed> =
  withOrder(major, true)

export const MINOR_NUTRIENT_DEFINITIONS: ReadonlyArray<NutrientDefinitionSeed> =
  withOrder(minor, false)

export const NUTRIENT_DEFINITION_SEEDS: ReadonlyArray<NutrientDefinitionSeed> =
  [...MAJOR_NUTRIENT_DEFINITIONS, ...MINOR_NUTRIENT_DEFINITIONS]

export const upsertNutrientDefinitions = async (
  sql: SqlOrTx,
  defs: ReadonlyArray<NutrientDefinitionSeed>,
): Promise<void> => {
  if (defs.length === 0) return
  const rows = defs.map((d) => ({
    code: d.code,
    display_name: d.displayName,
    unit: d.unit,
    is_major: d.isMajor ?? false,
    sort_order: d.sortOrder ?? 0,
  }))
  await sql`
    INSERT INTO nutrient_definitions ${sql(rows)}
    ON CONFLICT (code) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      unit = EXCLUDED.unit,
      is_major = EXCLUDED.is_major,
      sort_order = EXCLUDED.sort_order
  `
}

export const seedNutrientDefinitions = async (sql: Sql): Promise<void> => {
  await upsertNutrientDefinitions(sql, NUTRIENT_DEFINITION_SEEDS)
}
