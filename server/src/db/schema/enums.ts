import { pgEnum } from 'drizzle-orm/pg-core'

export const foodSourceEnum = pgEnum('food_source', [
  'web_search',
  'composition_table_estimate',
  'user_input',
  'model_estimate',
])

export const nutrientUnitEnum = pgEnum('nutrient_unit', [
  'kcal',
  'g',
  'mg',
  'µg',
])

export const mealTypeEnum = pgEnum('meal_type', [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
])

export const deliveryStatusEnum = pgEnum('delivery_status', [
  'planned',
  'received',
  'cancelled',
])
