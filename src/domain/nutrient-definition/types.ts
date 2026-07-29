import type { ResultAsync } from 'neverthrow'

import type { NutrientUnit } from '#db/seed/nutrient-definitions'

export type { NutrientUnit }

export interface NutrientDefinition {
  readonly code: string
  readonly displayName: string
  readonly unit: NutrientUnit
  readonly isMajor: boolean
  readonly sortOrder: number
}

export class NutrientDefinitionQueryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'NutrientDefinitionQueryError'
  }
}

export interface NutrientDefinitionRepository {
  // Ordered by isMajor desc, then sortOrder asc, so major nutrients (the
  // UI's default-visible set) always come first.
  list(): ResultAsync<
    ReadonlyArray<NutrientDefinition>,
    NutrientDefinitionQueryError
  >
}
