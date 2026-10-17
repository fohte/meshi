import { useEffect, useRef, useState } from 'react'

import type { MealPhoto } from '#api/meal-photos'
import { MEAL_PHOTO_ACCEPT } from '#components/MealPhotoGallery/meal-photo-constraints'
import styles from '#components/MealPhotoGallery/MealPhotoGallery.module.css'
import { getMealPhotoFileError } from '#components/MealPhotoGallery/validate-meal-photo-file'

export interface MealPhotoGalleryProps {
  readonly photos: ReadonlyArray<MealPhoto>
  readonly isLoading?: boolean
  readonly loadError?: string
  readonly onRetry?: () => void
  readonly isUploading?: boolean
  readonly isUploadDisabled?: boolean
  readonly uploadError?: string
  readonly previewPhoto?: MealPhoto | null
  readonly isDeleting?: boolean
  readonly deleteError?: string
  readonly onUpload: (file: File) => void
  readonly onPhotoClick: (photo: MealPhoto) => void
  readonly onClosePreview: () => void
  readonly onDeletePhoto: (id: string) => void
}

export const MealPhotoGallery = ({
  photos,
  isLoading = false,
  loadError,
  onRetry,
  isUploading = false,
  isUploadDisabled = false,
  uploadError,
  previewPhoto,
  isDeleting = false,
  deleteError,
  onUpload,
  onPhotoClick,
  onClosePreview,
  onDeletePhoto,
}: MealPhotoGalleryProps): React.JSX.Element => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onClosePreviewRef = useRef(onClosePreview)
  const [fileError, setFileError] = useState<string | undefined>()

  useEffect(() => {
    onClosePreviewRef.current = onClosePreview
  }, [onClosePreview])

  useEffect(() => {
    if (previewPhoto === null || previewPhoto === undefined) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClosePreviewRef.current()
    }

    window.addEventListener('keydown', handleKeyDown)
    closeButtonRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [previewPhoto?.id])

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = event.currentTarget.files?.item(0)
    event.currentTarget.value = ''
    if (file === null || file === undefined) return

    const error = getMealPhotoFileError(file)
    setFileError(error)
    if (error === undefined) onUpload(file)
  }

  return (
    <>
      <div className={styles.gallery}>
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            className={styles.thumbnailButton}
            aria-label={`写真 ${String(index + 1)} を拡大表示`}
            onClick={() => {
              onPhotoClick(photo)
            }}
          >
            <img
              className={styles.thumbnail}
              src={photo.contentUrl}
              alt=""
              loading="lazy"
            />
          </button>
        ))}
        <button
          type="button"
          className={styles.addButton}
          disabled={isUploadDisabled || isUploading}
          onClick={() => {
            fileInputRef.current?.click()
          }}
        >
          <span className={styles.addMark} aria-hidden="true">
            +
          </span>
          {isUploading ? 'アップロード中' : '追加'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={MEAL_PHOTO_ACCEPT}
          aria-label="追加する写真を選択"
          className={styles.fileInput}
          tabIndex={-1}
          onChange={handleFileChange}
        />
      </div>
      {isLoading && <div className={styles.status}>写真を読み込み中...</div>}
      {loadError !== undefined && (
        <div className={styles.error} role="alert">
          <span>{loadError}</span>
          {onRetry !== undefined && (
            <button
              type="button"
              className={styles.retryButton}
              onClick={onRetry}
            >
              再試行
            </button>
          )}
        </div>
      )}
      {(fileError ?? uploadError) !== undefined && (
        <div className={styles.error} role="alert">
          {fileError ?? uploadError}
        </div>
      )}

      {previewPhoto !== null && previewPhoto !== undefined && (
        <div
          className={styles.overlay}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClosePreview()
          }}
        >
          <section
            className={styles.previewDialog}
            role="dialog"
            aria-modal="true"
            aria-label="食事の写真"
          >
            <div className={styles.previewActions}>
              <button
                ref={closeButtonRef}
                type="button"
                className={styles.closeButton}
                onClick={onClosePreview}
              >
                閉じる
              </button>
            </div>
            <img
              className={styles.previewImage}
              src={previewPhoto.contentUrl}
              alt="食事の写真"
            />
            {deleteError !== undefined && (
              <div className={styles.error} role="alert">
                {deleteError}
              </div>
            )}
            <div className={styles.previewActions}>
              <button
                type="button"
                className={styles.deleteButton}
                disabled={isDeleting}
                onClick={() => {
                  onDeletePhoto(previewPhoto.id)
                }}
              >
                {isDeleting ? '削除中...' : '削除'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
