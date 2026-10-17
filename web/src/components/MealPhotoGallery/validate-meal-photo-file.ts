import { MAX_MEAL_PHOTO_SIZE, MEAL_PHOTO_CONTENT_TYPES } from '#api/meal-photos'
import {
  MEAL_PHOTO_FORMAT_ERROR_MESSAGE,
  MEAL_PHOTO_SIZE_ERROR_MESSAGE,
} from '#components/MealPhotoGallery/meal-photo-constraints'

export const getMealPhotoFileError = (
  file: Pick<File, 'size' | 'type'>,
): string | undefined => {
  if (file.size === 0) {
    return 'ファイルに画像データがありません。別の写真を選択してください。'
  }
  if (file.size > MAX_MEAL_PHOTO_SIZE) {
    return MEAL_PHOTO_SIZE_ERROR_MESSAGE
  }
  if (
    !MEAL_PHOTO_CONTENT_TYPES.some(
      (contentType) => contentType === file.type.toLowerCase(),
    )
  ) {
    return MEAL_PHOTO_FORMAT_ERROR_MESSAGE
  }
  return undefined
}
