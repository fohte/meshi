import { MAX_MEAL_PHOTO_SIZE, MEAL_PHOTO_CONTENT_TYPES } from '#api/meal-photos'

export const getMealPhotoFileError = (
  file: Pick<File, 'size' | 'type'>,
): string | undefined => {
  if (file.size === 0) {
    return 'ファイルに画像データがありません。別の写真を選択してください。'
  }
  if (file.size > MAX_MEAL_PHOTO_SIZE) {
    return '写真は 10 MiB 以下のファイルを選択してください。'
  }
  if (
    !MEAL_PHOTO_CONTENT_TYPES.some(
      (contentType) => contentType === file.type.toLowerCase(),
    )
  ) {
    return 'JPEG、PNG、WebP 形式の写真を選択してください。'
  }
  return undefined
}
