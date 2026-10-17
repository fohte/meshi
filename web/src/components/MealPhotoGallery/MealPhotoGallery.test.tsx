import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MealPhoto } from '#api/meal-photos'
import { MealPhotoGallery } from '#components/MealPhotoGallery/MealPhotoGallery'

afterEach(() => {
  vi.unstubAllGlobals()
})

const photo: MealPhoto = {
  id: 'photo_alpha',
  date: '2040-01-02',
  mealType: 'lunch',
  contentType: 'image/jpeg',
  createdAt: '2040-01-02T03:00:00.000Z',
  contentUrl:
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"%3E%3Crect width="120" height="120" fill="%232a2a2a"/%3E%3C/svg%3E',
}

type GalleryEvent =
  | { readonly action: 'open'; readonly photo: MealPhoto }
  | { readonly action: 'requestDelete' }
  | { readonly action: 'cancelDelete' }
  | { readonly action: 'delete'; readonly photoId: string }
  | { readonly action: 'close' }

const performAct = (callback: () => void): Promise<void> =>
  act(async () => {
    callback()
    await Promise.resolve()
  })

const renderGallery = (
  root: Root,
  events: Array<GalleryEvent>,
  previewPhoto: MealPhoto | null,
  isDeleteConfirmationOpen = false,
): void => {
  root.render(
    <MealPhotoGallery
      mealName="昼食"
      photos={[photo]}
      previewPhoto={previewPhoto}
      isDeleteConfirmationOpen={isDeleteConfirmationOpen}
      onUpload={() => {}}
      onPhotoClick={(selectedPhoto) => {
        events.push({ action: 'open', photo: selectedPhoto })
      }}
      onClosePreview={() => {
        events.push({ action: 'close' })
      }}
      onRequestDelete={() => {
        events.push({ action: 'requestDelete' })
      }}
      onCancelDeleteConfirmation={() => {
        events.push({ action: 'cancelDelete' })
      }}
      onDeletePhoto={(photoId) => {
        events.push({ action: 'delete', photoId })
      }}
    />,
  )
}

describe('MealPhotoGallery', () => {
  it('requests deletion only after confirmation', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const events: Array<GalleryEvent> = []

    try {
      await performAct(() => {
        renderGallery(root, events, null)
      })

      const thumbnail = container.querySelector<HTMLButtonElement>(
        'button[aria-label="昼食の写真 1 を拡大表示"]',
      )
      await performAct(() => {
        thumbnail?.click()
      })
      await performAct(() => {
        renderGallery(root, events, photo)
      })

      const deleteButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent === '削除')
      await performAct(() => {
        deleteButton?.click()
      })
      await performAct(() => {
        renderGallery(root, events, photo, true)
      })

      const cancelButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent === 'やめる')
      await performAct(() => {
        cancelButton?.click()
      })
      await performAct(() => {
        renderGallery(root, events, photo)
      })

      const retryDeleteButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent === '削除')
      await performAct(() => {
        retryDeleteButton?.click()
      })
      await performAct(() => {
        renderGallery(root, events, photo, true)
      })

      const confirmButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent === '本当に削除する')
      await performAct(() => {
        confirmButton?.click()
      })

      expect(events).toEqual([
        { action: 'open', photo },
        { action: 'requestDelete' },
        { action: 'cancelDelete' },
        { action: 'requestDelete' },
        { action: 'delete', photoId: photo.id },
      ])
    } finally {
      await performAct(() => {
        root.unmount()
      })
      container.remove()
    }
  })

  it('restores focus and scrolling after closing the photo modal', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const originalBodyOverflow = document.body.style.overflow
    const originalDocumentOverflow = document.documentElement.style.overflow
    const events: Array<GalleryEvent> = []

    try {
      await performAct(() => {
        renderGallery(root, events, null)
      })

      const thumbnail = container.querySelector<HTMLButtonElement>(
        'button[aria-label="昼食の写真 1 を拡大表示"]',
      )
      await performAct(() => {
        thumbnail?.click()
      })
      await performAct(() => {
        renderGallery(root, events, photo)
      })

      const dialog = container.querySelector<HTMLDialogElement>('dialog')
      const isModal = dialog?.matches(':modal') ?? false
      const bodyOverflowWhileOpen = document.body.style.overflow
      const documentOverflowWhileOpen = document.documentElement.style.overflow
      const fileInputLabel = container
        .querySelector<HTMLInputElement>('input[type="file"]')
        ?.getAttribute('aria-label')

      const closeButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent === '閉じる')
      await performAct(() => {
        closeButton?.click()
      })
      await performAct(() => {
        renderGallery(root, events, null)
      })

      const getGalleryState = () => ({
        events,
        fileInputLabel,
        isModal,
        bodyOverflowWhileOpen,
        documentOverflowWhileOpen,
        isDialogClosed: dialog?.open === false,
        focusReturnedToThumbnail: document.activeElement === thumbnail,
        bodyOverflowAfterClose: document.body.style.overflow,
        documentOverflowAfterClose: document.documentElement.style.overflow,
      })
      expect(getGalleryState()).toEqual({
        events: [{ action: 'open', photo }, { action: 'close' }],
        fileInputLabel: '昼食に追加する写真を選択',
        isModal: true,
        bodyOverflowWhileOpen: 'hidden',
        documentOverflowWhileOpen: 'hidden',
        isDialogClosed: true,
        focusReturnedToThumbnail: true,
        bodyOverflowAfterClose: originalBodyOverflow,
        documentOverflowAfterClose: originalDocumentOverflow,
      })
    } finally {
      await performAct(() => {
        root.unmount()
      })
      document.body.style.overflow = originalBodyOverflow
      document.documentElement.style.overflow = originalDocumentOverflow
      container.remove()
    }
  })
})
