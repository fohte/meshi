import { MealPhotoRequestError } from '#api/meal-photos'
import {
  MEAL_PHOTO_FORMAT_ERROR_MESSAGE,
  MEAL_PHOTO_SIZE_ERROR_MESSAGE,
} from '#components/MealPhotoGallery/meal-photo-constraints'

export const getMealPhotoUploadErrorMessage = (error: unknown): string => {
  if (error instanceof MealPhotoRequestError && error.status === 413) {
    return MEAL_PHOTO_SIZE_ERROR_MESSAGE
  }
  if (error instanceof MealPhotoRequestError && error.status === 400) {
    return MEAL_PHOTO_FORMAT_ERROR_MESSAGE
  }
  return '写真をアップロードできませんでした。しばらくしてから再度お試しください。'
}
