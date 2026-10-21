import { z } from 'zod'

import type { MealType } from '#domain/meal-log/types'
import type { JstDate } from '#lib/jst-date'

export const MEAL_PHOTO_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export const mealPhotoContentTypeSchema = z.enum(MEAL_PHOTO_CONTENT_TYPES)

export type MealPhotoContentType = z.infer<typeof mealPhotoContentTypeSchema>

export interface MealPhotoRow {
  readonly id: string
  readonly date: JstDate
  readonly mealType: MealType
  readonly objectKey: string
  readonly contentType: MealPhotoContentType
  readonly createdAt: Date
}

export interface MealPhotoContent {
  readonly photo: MealPhotoRow
  readonly bytes: Uint8Array
}
