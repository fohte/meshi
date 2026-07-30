import type { NutrientDefinition } from '#api/nutrient-definitions'

const ENERGY_CODE = 'energy_kcal'
const PROTEIN_CODE = 'protein_g'
const FAT_CODE = 'fat_g'
const CARB_CODE = 'carb_g'

// Default PFC balance ratio (% of energy) — a general dietary guideline used
// as a fallback when the profile's daily targets don't have all four values
// (energy_kcal, protein_g, fat_g, carb_g) needed to derive a per-user ratio.
const PFC_TARGET_RATIO = { protein: 20, fat: 25, carb: 55 }
const PFC_COLOR = {
  protein: 'var(--color-text)',
  fat: 'var(--color-muted)',
  carb: '#3f3f46',
}

const OVER_TARGET_PCT = 110

export interface NutrientRow {
  readonly code: string
  readonly label: string
  readonly unit: string
  readonly value: number
  readonly target: number | null
  readonly pct: number
  readonly over: boolean
}

export interface PfcSegment {
  readonly label: string
  readonly color: string
  readonly pct: number
  readonly targetPct: number
}

export interface NutritionSummaryData {
  readonly energy: {
    readonly value: number
    readonly target: number | null
    readonly pct: number | null
    readonly over: boolean
  }
  readonly pfc: {
    readonly segments: readonly [PfcSegment, PfcSegment, PfcSegment]
    readonly targetMarks: readonly [number, number]
  }
  readonly majorRows: ReadonlyArray<NutrientRow>
  readonly allRows: ReadonlyArray<NutrientRow>
  readonly hasAnyTarget: boolean
}

export const buildNutritionSummaryData = (
  totals: Readonly<Record<string, number>>,
  definitions: ReadonlyArray<NutrientDefinition>,
  targets: Readonly<Record<string, number>> | null,
): NutritionSummaryData => {
  const valueFor = (code: string): number => totals[code] ?? 0
  const targetFor = (code: string): number | null => targets?.[code] ?? null
  // A target of 0 (or negative, though the settings form doesn't offer a way
  // to enter one) can't drive a percentage — treat it the same as "no
  // target" rather than showing NaN%/Infinity%.
  const isUsableTarget = (target: number | null): target is number =>
    target !== null && target > 0

  const toRow = (def: NutrientDefinition): NutrientRow => {
    const value = valueFor(def.code)
    const target = targetFor(def.code)
    const usableTarget = isUsableTarget(target)
    const pct = usableTarget ? (value / target) * 100 : 0
    return {
      code: def.code,
      label: def.displayName,
      unit: def.unit,
      value,
      target,
      pct,
      over: usableTarget && pct > OVER_TARGET_PCT,
    }
  }

  const allRows = definitions.map(toRow)
  const majorRows = definitions
    .filter((def) => def.isMajor && def.code !== ENERGY_CODE)
    .map(toRow)

  const energyTarget = targetFor(ENERGY_CODE)
  const energyValue = valueFor(ENERGY_CODE)
  const energyUsableTarget = isUsableTarget(energyTarget)
  const energyPct = energyUsableTarget
    ? (energyValue / energyTarget) * 100
    : null
  const energy = {
    value: energyValue,
    target: energyTarget,
    pct: energyPct,
    over: energyPct !== null && energyPct > OVER_TARGET_PCT,
  }

  const proteinKcal = valueFor(PROTEIN_CODE) * 4
  const fatKcal = valueFor(FAT_CODE) * 9
  const carbKcal = valueFor(CARB_CODE) * 4
  const totalPfcKcal = Math.max(1, proteinKcal + fatKcal + carbKcal)
  const proteinPct = (proteinKcal / totalPfcKcal) * 100
  const fatPct = (fatKcal / totalPfcKcal) * 100
  const carbPct = (carbKcal / totalPfcKcal) * 100

  const proteinTarget = targetFor(PROTEIN_CODE)
  const fatTarget = targetFor(FAT_CODE)
  const carbTarget = targetFor(CARB_CODE)
  const pfcTargetRatio =
    proteinTarget !== null &&
    fatTarget !== null &&
    carbTarget !== null &&
    isUsableTarget(energyTarget)
      ? {
          protein: ((proteinTarget * 4) / energyTarget) * 100,
          fat: ((fatTarget * 9) / energyTarget) * 100,
          carb: ((carbTarget * 4) / energyTarget) * 100,
        }
      : PFC_TARGET_RATIO

  const hasAnyTarget = targets !== null && Object.keys(targets).length > 0

  return {
    energy,
    pfc: {
      segments: [
        {
          label: 'たんぱく質',
          color: PFC_COLOR.protein,
          pct: proteinPct,
          targetPct: pfcTargetRatio.protein,
        },
        {
          label: '脂質',
          color: PFC_COLOR.fat,
          pct: fatPct,
          targetPct: pfcTargetRatio.fat,
        },
        {
          label: '炭水化物',
          color: PFC_COLOR.carb,
          pct: carbPct,
          targetPct: pfcTargetRatio.carb,
        },
      ],
      targetMarks: [
        pfcTargetRatio.protein,
        pfcTargetRatio.protein + pfcTargetRatio.fat,
      ],
    },
    majorRows,
    allRows,
    hasAnyTarget,
  }
}
