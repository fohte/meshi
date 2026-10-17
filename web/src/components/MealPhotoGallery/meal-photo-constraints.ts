import { MAX_MEAL_PHOTO_SIZE, MEAL_PHOTO_CONTENT_TYPES } from '#api/meal-photos'

const contentTypeLabels: Record<
  (typeof MEAL_PHOTO_CONTENT_TYPES)[number],
  string
> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
}

export const MEAL_PHOTO_ACCEPT = MEAL_PHOTO_CONTENT_TYPES.join(',')

export const MEAL_PHOTO_SIZE_ERROR_MESSAGE = `写真は ${String(
  MAX_MEAL_PHOTO_SIZE / 1024 ** 2,
)} MiB 以下のファイルを選択してください。`

export const MEAL_PHOTO_FORMAT_ERROR_MESSAGE = `${MEAL_PHOTO_CONTENT_TYPES.map(
  (contentType) => contentTypeLabels[contentType],
).join('、')} 形式の写真を選択してください。`
