import { useEffect, useRef, useState } from 'react'

import type { MealPhoto } from '#api/meal-photos'
import { MEAL_PHOTO_ACCEPT } from '#components/MealPhotoGallery/meal-photo-constraints'
import styles from '#components/MealPhotoGallery/MealPhotoGallery.module.css'
import { getMealPhotoFileError } from '#components/MealPhotoGallery/validate-meal-photo-file'

export interface MealPhotoGalleryProps {
  readonly mealName: string
  readonly photos: ReadonlyArray<MealPhoto>
  readonly isLoading?: boolean
  readonly loadError?: string
  readonly onRetry?: () => void
  readonly isUploading?: boolean
  readonly isUploadDisabled?: boolean
  readonly uploadError?: string
  readonly previewPhoto?: MealPhoto | null
  readonly isDeleteConfirmationOpen?: boolean
  readonly isDeleting?: boolean
  readonly deleteError?: string
  readonly onUpload: (file: File) => void
  readonly onPhotoClick: (photo: MealPhoto) => void
  readonly onClosePreview: () => void
  readonly onRequestDelete: () => void
  readonly onCancelDeleteConfirmation: () => void
  readonly onDeletePhoto: (id: string) => void
}

export const MealPhotoGallery = ({
  mealName,
  photos,
  isLoading = false,
  loadError,
  onRetry,
  isUploading = false,
  isUploadDisabled = false,
  uploadError,
  previewPhoto,
  isDeleteConfirmationOpen = false,
  isDeleting = false,
  deleteError,
  onUpload,
  onPhotoClick,
  onClosePreview,
  onRequestDelete,
  onCancelDeleteConfirmation,
  onDeletePhoto,
}: MealPhotoGalleryProps): React.JSX.Element => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null)
  const focusAddAfterCloseRef = useRef(false)
  const [fileError, setFileError] = useState<string | undefined>()

  const isPreviewOpen = previewPhoto !== null && previewPhoto !== undefined

  useEffect(() => {
    if (deleteError !== undefined) focusAddAfterCloseRef.current = false
  }, [deleteError])

  useEffect(() => {
    if (!isPreviewOpen) return
    const dialog = dialogRef.current
    if (dialog === null || dialog.open) return

    const previousBodyOverflow = document.body.style.overflow
    const previousDocumentOverflow = document.documentElement.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    return () => {
      if (dialog.open) dialog.close()
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousDocumentOverflow
      const trigger = previewTriggerRef.current
      if (
        focusAddAfterCloseRef.current ||
        trigger === null ||
        !trigger.isConnected
      ) {
        focusAddAfterCloseRef.current = false
        addButtonRef.current?.focus()
      } else {
        trigger.focus()
      }
    }
  }, [isPreviewOpen])

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
            aria-label={`${mealName}の写真 ${String(index + 1)} を拡大表示`}
            onClick={(event) => {
              previewTriggerRef.current = event.currentTarget
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
          ref={addButtonRef}
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
          aria-label={`${mealName}に追加する写真を選択`}
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
        <dialog
          ref={dialogRef}
          className={styles.previewDialog}
          aria-label={`${mealName}の写真`}
          onCancel={(event) => {
            event.preventDefault()
            onClosePreview()
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClosePreview()
          }}
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
            alt={`${mealName}の写真`}
          />
          {deleteError !== undefined && (
            <div className={styles.error} role="alert">
              {deleteError}
            </div>
          )}
          <div className={styles.previewActions}>
            {isDeleteConfirmationOpen ? (
              <>
                <button
                  type="button"
                  className={styles.deleteButton}
                  disabled={isDeleting}
                  onClick={() => {
                    focusAddAfterCloseRef.current = true
                    onDeletePhoto(previewPhoto.id)
                  }}
                >
                  {isDeleting ? '削除中...' : '本当に削除する'}
                </button>
                <button
                  type="button"
                  className={styles.closeButton}
                  disabled={isDeleting}
                  onClick={onCancelDeleteConfirmation}
                >
                  やめる
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.deleteButton}
                disabled={isDeleting}
                onClick={onRequestDelete}
              >
                {isDeleting ? '削除中...' : '削除'}
              </button>
            )}
          </div>
        </dialog>
      )}
    </>
  )
}
