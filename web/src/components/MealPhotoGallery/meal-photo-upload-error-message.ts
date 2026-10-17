import { MealPhotoRequestError } from '#api/meal-photos'

export const getMealPhotoUploadErrorMessage = (error: unknown): string => {
  if (error instanceof MealPhotoRequestError && error.status === 413) {
    return '写真は 10 MiB 以下のファイルを選択してください。'
  }
  if (error instanceof MealPhotoRequestError && error.status === 400) {
    return 'JPEG、PNG、WebP 形式の写真を選択してください。'
  }
  return '写真をアップロードできませんでした。しばらくしてから再度お試しください。'
}
