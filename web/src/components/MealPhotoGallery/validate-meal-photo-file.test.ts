import { describe, expect, it } from 'vitest'

import { getMealPhotoFileError } from '#components/MealPhotoGallery/validate-meal-photo-file'

describe('getMealPhotoFileError', () => {
  it('accepts a supported image within the size limit', () => {
    expect(getMealPhotoFileError({ size: 1024, type: 'image/jpeg' })).toEqual(
      undefined,
    )
  })

  it('rejects an empty file', () => {
    expect(getMealPhotoFileError({ size: 0, type: 'image/jpeg' })).toEqual(
      'ファイルに画像データがありません。別の写真を選択してください。',
    )
  })

  it('rejects an image larger than 10 MiB', () => {
    expect(
      getMealPhotoFileError({ size: 10 * 1024 * 1024 + 1, type: 'image/jpeg' }),
    ).toEqual('写真は 10 MiB 以下のファイルを選択してください。')
  })

  it('rejects an unsupported image format', () => {
    expect(getMealPhotoFileError({ size: 1024, type: 'image/heic' })).toEqual(
      'JPEG、PNG、WebP 形式の写真を選択してください。',
    )
  })
})
