import type { Meta, StoryObj } from '@storybook/react-vite'

import type { MealPhoto } from '#api/meal-photos'
import { MealPhotoGallery } from '#components/MealPhotoGallery/MealPhotoGallery'

const PLACEHOLDER_IMAGE =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"%3E%3Crect width="320" height="240" fill="%232a2a2a"/%3E%3Ccircle cx="160" cy="120" r="64" fill="%23ef4444"/%3E%3C/svg%3E'

const FIRST_PHOTO: MealPhoto = {
  id: 'meal_photo_one',
  date: '2026-07-29',
  mealType: 'breakfast',
  contentType: 'image/jpeg',
  createdAt: '2026-07-29T03:00:01.000Z',
  contentUrl: PLACEHOLDER_IMAGE,
}

const PHOTOS: ReadonlyArray<MealPhoto> = [
  FIRST_PHOTO,
  {
    id: 'meal_photo_two',
    date: '2026-07-29',
    mealType: 'breakfast',
    contentType: 'image/jpeg',
    createdAt: '2026-07-29T03:00:02.000Z',
    contentUrl: PLACEHOLDER_IMAGE,
  },
]

const meta: Meta<typeof MealPhotoGallery> = {
  title: 'components/MealPhotoGallery',
  component: MealPhotoGallery,
  args: {
    photos: [],
    onUpload: () => undefined,
    onPhotoClick: () => undefined,
    onClosePreview: () => undefined,
    onDeletePhoto: () => undefined,
  },
}

export default meta

type Story = StoryObj<typeof MealPhotoGallery>

export const Empty: Story = {
  name: '写真がなく、追加ボタンだけ表示されています',
}

export const WithPhotos: Story = {
  name: '朝食に 2 枚の写真があります',
  args: { photos: PHOTOS },
}

export const Uploading: Story = {
  name: '写真をアップロードしています',
  args: { isUploading: true, isUploadDisabled: true, photos: PHOTOS },
}

export const UploadFailed: Story = {
  name: 'アップロードに失敗した理由を表示しています',
  args: {
    uploadError: '写真は 10 MiB 以下のファイルを選択してください。',
  },
}

export const LoadingPhotos: Story = {
  name: '食事の写真を読み込んでいます',
  args: { isLoading: true },
}

export const LoadingFailed: Story = {
  name: '写真の読み込みに失敗し、再試行を表示しています',
  args: {
    loadError: '写真を読み込めませんでした。',
    onRetry: () => undefined,
  },
}

export const PreviewOpen: Story = {
  name: '選択した写真を拡大表示しています',
  args: { photos: PHOTOS, previewPhoto: FIRST_PHOTO },
}

export const Deleting: Story = {
  name: '拡大表示した写真を削除しています',
  args: {
    photos: PHOTOS,
    previewPhoto: FIRST_PHOTO,
    isDeleting: true,
  },
}

export const DeleteFailed: Story = {
  name: '写真の削除に失敗した理由を表示しています',
  args: {
    photos: PHOTOS,
    previewPhoto: FIRST_PHOTO,
    deleteError: '写真を削除できませんでした。もう一度お試しください。',
  },
}
