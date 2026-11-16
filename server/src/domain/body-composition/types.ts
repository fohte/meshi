import type { JstDate } from '#lib/jst-date'

export interface BodyComposition {
  readonly id: string
  readonly date: JstDate
  readonly measuredAt: Date | null
  readonly device: string
  readonly bodyFatPercent: number | null
  readonly muscleMassKg: number | null
  readonly skeletalMusclePercent: number | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface RecordBodyCompositionInput {
  readonly date: JstDate
  readonly measuredAt?: Date | null
  readonly device: string
  readonly bodyFatPercent?: number | null
  readonly muscleMassKg?: number | null
  readonly skeletalMusclePercent?: number | null
}

export interface UpdateBodyCompositionInput {
  readonly id: string
  readonly date?: JstDate
  readonly measuredAt?: Date | null
  readonly device?: string
  readonly bodyFatPercent?: number | null
  readonly muscleMassKg?: number | null
  readonly skeletalMusclePercent?: number | null
}
