import type { ResultAsync } from 'neverthrow'

import type { MealType } from '#domain/meal-log/types'
import type { MealPhotoDomainError } from '#domain/meal-photo/errors'
import type {
  MealPhotoContentType,
  MealPhotoRow,
} from '#domain/meal-photo/types'
import type { JstDate } from '#lib/jst-date'

export interface InsertMealPhotoInput {
  readonly id: string
  readonly date: JstDate
  readonly mealType: MealType
  readonly objectKey: string
  readonly contentType: MealPhotoContentType
  readonly createdAt?: Date
}

export interface MealPhotoRepository {
  insert(
    input: InsertMealPhotoInput,
  ): ResultAsync<MealPhotoRow, MealPhotoDomainError>
  findForMeal(
    date: JstDate,
    mealType: MealType,
  ): ResultAsync<ReadonlyArray<MealPhotoRow>, MealPhotoDomainError>
  findById(id: string): ResultAsync<MealPhotoRow | null, MealPhotoDomainError>
  deleteById(id: string): ResultAsync<MealPhotoRow | null, MealPhotoDomainError>
}
