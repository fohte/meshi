import type { JstDate } from '#lib/jst-date'

export interface BodyWeight {
  readonly id: string
  readonly date: JstDate
  readonly measuredAt: Date | null
  readonly weightKg: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface RecordBodyWeightInput {
  readonly date: JstDate
  readonly measuredAt?: Date
  readonly weightKg: number
}

export interface UpdateBodyWeightInput {
  readonly id: string
  readonly date?: JstDate
  readonly measuredAt?: Date | null
  readonly weightKg?: number
}
