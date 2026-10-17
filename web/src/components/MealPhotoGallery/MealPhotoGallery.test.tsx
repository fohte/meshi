import { act } from 'react'
import { createRoot } from 'react-dom/client'
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
  contentUrl: '/api/meal-photos/photo_alpha/content',
}

const performAct = (callback: () => void): Promise<void> =>
  act(async () => {
    callback()
    await Promise.resolve()
  })

describe('MealPhotoGallery', () => {
  it('opens a photo and requests deletion of that photo', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const events: Array<
      | { readonly action: 'open'; readonly photo: MealPhoto }
      | { readonly action: 'delete'; readonly photoId: string }
    > = []

    try {
      await performAct(() => {
        root.render(
          <MealPhotoGallery
            photos={[photo]}
            onUpload={() => {}}
            onPhotoClick={(selectedPhoto) => {
              events.push({ action: 'open', photo: selectedPhoto })
            }}
            onClosePreview={() => {}}
            onDeletePhoto={(photoId) => {
              events.push({ action: 'delete', photoId })
            }}
          />,
        )
      })

      const thumbnail = container.querySelector<HTMLButtonElement>(
        'button[aria-label="写真 1 を拡大表示"]',
      )
      await performAct(() => {
        thumbnail?.click()
      })

      await performAct(() => {
        root.render(
          <MealPhotoGallery
            photos={[photo]}
            previewPhoto={photo}
            onUpload={() => {}}
            onPhotoClick={() => {}}
            onClosePreview={() => {}}
            onDeletePhoto={(photoId) => {
              events.push({ action: 'delete', photoId })
            }}
          />,
        )
      })

      const deleteButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent === '削除')
      await performAct(() => {
        deleteButton?.click()
      })

      expect(events).toEqual([
        { action: 'open', photo },
        { action: 'delete', photoId: photo.id },
      ])
    } finally {
      await performAct(() => {
        root.unmount()
      })
      container.remove()
    }
  })
})
