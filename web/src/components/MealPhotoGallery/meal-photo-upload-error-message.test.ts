import { describe, expect, it } from 'vitest'

import { MealPhotoRequestError } from '#api/meal-photos'
import { getMealPhotoUploadErrorMessage } from '#components/MealPhotoGallery/meal-photo-upload-error-message'

describe('getMealPhotoUploadErrorMessage', () => {
  it('explains that the selected image exceeds the size limit', () => {
    expect(
      getMealPhotoUploadErrorMessage(
        new MealPhotoRequestError('/api/meal-photos/date/lunch', 413),
      ),
    ).toEqual('写真は 10 MiB 以下のファイルを選択してください。')
  })

  it('explains which image formats the server accepts', () => {
    expect(
      getMealPhotoUploadErrorMessage(
        new MealPhotoRequestError('/api/meal-photos/date/lunch', 400),
      ),
    ).toEqual('JPEG、PNG、WebP 形式の写真を選択してください。')
  })

  it('shows a general message for other request failures', () => {
    expect(getMealPhotoUploadErrorMessage(new Error('offline'))).toEqual(
      '写真をアップロードできませんでした。しばらくしてから再度お試しください。',
    )
  })
})
