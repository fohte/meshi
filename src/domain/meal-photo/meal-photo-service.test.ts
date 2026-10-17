import { errAsync, okAsync, type Result } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import {
  type MealPhotoDomainError,
  MealPhotoPersistenceError,
  MealPhotoStorageError,
} from '#domain/meal-photo/errors'
import type { MealPhotoObjectStore } from '#domain/meal-photo/meal-photo-object-store'
import type { MealPhotoRepository } from '#domain/meal-photo/meal-photo-repository'
import { createMealPhotoService } from '#domain/meal-photo/meal-photo-service'
import type {
  MealPhotoContentType,
  MealPhotoRow,
} from '#domain/meal-photo/types'
import { jstDate } from '#test/jst-date'

const PHOTO_DATE = jstDate('2099-03-15')
const CREATED_AT = new Date('2099-03-15T00:00:00.000Z')

const createHarness = (
  options: {
    readonly insertFails?: boolean
    readonly restorationFails?: boolean
    readonly storageDeleteFails?: boolean
  } = {},
) => {
  const metadata = new Map<string, MealPhotoRow>()
  const objects = new Map<
    string,
    { readonly contentType: MealPhotoContentType; readonly bytes: Uint8Array }
  >()
  let generatedIds = 0
  let insertCalls = 0

  const repository: MealPhotoRepository = {
    insert(input) {
      insertCalls += 1
      if (
        options.insertFails === true ||
        (options.restorationFails === true && insertCalls > 1)
      ) {
        return errAsync(new MealPhotoPersistenceError('insert failed'))
      }
      const row: MealPhotoRow = {
        id: input.id,
        date: input.date,
        mealType: input.mealType,
        objectKey: input.objectKey,
        contentType: input.contentType,
        createdAt: input.createdAt ?? CREATED_AT,
      }
      metadata.set(row.id, row)
      return okAsync(row)
    },
    findForMeal(date, mealType) {
      return okAsync(
        [...metadata.values()].filter(
          (photo) => photo.date === date && photo.mealType === mealType,
        ),
      )
    },
    findById(id) {
      return okAsync(metadata.get(id) ?? null)
    },
    deleteById(id) {
      const row = metadata.get(id) ?? null
      if (row !== null) metadata.delete(id)
      return okAsync(row)
    },
  }

  const objectStore: MealPhotoObjectStore = {
    put(input) {
      objects.set(input.objectKey, {
        contentType: input.contentType,
        bytes: input.bytes,
      })
      return okAsync(undefined)
    },
    get(objectKey) {
      const object = objects.get(objectKey)
      return object === undefined
        ? errAsync(new MealPhotoStorageError('object missing'))
        : okAsync(object.bytes)
    },
    delete(objectKey) {
      if (options.storageDeleteFails === true) {
        return errAsync(new MealPhotoStorageError('delete failed'))
      }
      objects.delete(objectKey)
      return okAsync(undefined)
    },
  }

  return {
    service: createMealPhotoService({
      repository,
      objectStore,
      idGenerator: () => {
        generatedIds += 1
        return 'meal_photo_fixture'
      },
    }),
    metadata,
    objects,
    getGeneratedIds: () => generatedIds,
  }
}

type Harness = ReturnType<typeof createHarness>
type PhotoResult = Result<MealPhotoRow, MealPhotoDomainError>
type DeleteResult = Result<void, MealPhotoDomainError>

const captureUploadState = (result: PhotoResult, harness: Harness) => ({
  result: result.match(
    (photo) => ({ status: 'ok', photo }),
    (error) => ({ status: 'error', code: error.code, message: error.message }),
  ),
  metadata: [...harness.metadata.values()],
  objects: [...harness.objects.entries()].map(([objectKey, object]) => ({
    objectKey,
    contentType: object.contentType,
    bytes: [...object.bytes],
  })),
  generatedIds: harness.getGeneratedIds(),
  metadataCount: harness.metadata.size,
  objectCount: harness.objects.size,
})

const captureDeleteState = (result: DeleteResult, harness: Harness) => ({
  result: result.match(
    () => ({ status: 'ok' }),
    (error) => ({ status: 'error', code: error.code, message: error.message }),
  ),
  metadata: [...harness.metadata.values()],
  metadataCount: harness.metadata.size,
  objectCount: harness.objects.size,
})

describe('createMealPhotoService', () => {
  it('stores photo bytes and metadata with one generated ID', async () => {
    const harness = createHarness()
    const result = await harness.service.upload({
      date: PHOTO_DATE,
      mealType: 'breakfast',
      contentType: 'image/png',
      bytes: new Uint8Array([80, 78, 71]),
    })

    expect(captureUploadState(result, harness)).toEqual({
      result: {
        status: 'ok',
        photo: {
          id: 'meal_photo_fixture',
          date: PHOTO_DATE,
          mealType: 'breakfast',
          objectKey: 'meal-photos/meal_photo_fixture',
          contentType: 'image/png',
          createdAt: CREATED_AT,
        },
      },
      metadata: [
        {
          id: 'meal_photo_fixture',
          date: PHOTO_DATE,
          mealType: 'breakfast',
          objectKey: 'meal-photos/meal_photo_fixture',
          contentType: 'image/png',
          createdAt: CREATED_AT,
        },
      ],
      objects: [
        {
          objectKey: 'meal-photos/meal_photo_fixture',
          contentType: 'image/png',
          bytes: [80, 78, 71],
        },
      ],
      generatedIds: 1,
      metadataCount: 1,
      objectCount: 1,
    })
  })

  it('removes an uploaded object when metadata insert fails', async () => {
    const harness = createHarness({ insertFails: true })
    const result = await harness.service.upload({
      date: PHOTO_DATE,
      mealType: 'lunch',
      contentType: 'image/jpeg',
      bytes: new Uint8Array([1, 2, 3]),
    })

    expect(captureUploadState(result, harness)).toEqual({
      result: {
        status: 'error',
        code: 'meal_photo/persistence_failed',
        message: 'insert failed',
      },
      metadata: [],
      objects: [],
      generatedIds: 1,
      metadataCount: 0,
      objectCount: 0,
    })
  })

  it('reports a consistency error when upload cleanup also fails', async () => {
    const harness = createHarness({
      insertFails: true,
      storageDeleteFails: true,
    })
    const result = await harness.service.upload({
      date: PHOTO_DATE,
      mealType: 'lunch',
      contentType: 'image/jpeg',
      bytes: new Uint8Array([1, 2, 3]),
    })

    expect(captureUploadState(result, harness)).toEqual({
      result: {
        status: 'error',
        code: 'meal_photo/consistency_failed',
        message:
          'failed to remove the uploaded object after metadata insert failed',
      },
      metadata: [],
      objects: [
        {
          objectKey: 'meal-photos/meal_photo_fixture',
          contentType: 'image/jpeg',
          bytes: [1, 2, 3],
        },
      ],
      generatedIds: 1,
      metadataCount: 0,
      objectCount: 1,
    })
  })

  it('returns photo bytes from the object store', async () => {
    const harness = createHarness()
    const uploaded = await harness.service.upload({
      date: PHOTO_DATE,
      mealType: 'dinner',
      contentType: 'image/webp',
      bytes: new Uint8Array([7, 8, 9]),
    })
    const photoId = uploaded.isOk() ? uploaded.value.id : 'missing'
    const result = await harness.service.getContent(photoId)

    expect(
      result.match(
        (content) => ({ photo: content.photo, bytes: [...content.bytes] }),
        (error) => ({ error: error.code }),
      ),
    ).toEqual({
      photo: {
        id: 'meal_photo_fixture',
        date: PHOTO_DATE,
        mealType: 'dinner',
        objectKey: 'meal-photos/meal_photo_fixture',
        contentType: 'image/webp',
        createdAt: CREATED_AT,
      },
      bytes: [7, 8, 9],
    })
  })

  it('removes metadata and object bytes together', async () => {
    const harness = createHarness()
    await harness.service.upload({
      date: PHOTO_DATE,
      mealType: 'snack',
      contentType: 'image/png',
      bytes: new Uint8Array([3, 2, 1]),
    })
    const result = await harness.service.delete('meal_photo_fixture')

    expect(captureDeleteState(result, harness)).toEqual({
      result: { status: 'ok' },
      metadata: [],
      metadataCount: 0,
      objectCount: 0,
    })
  })

  it('restores metadata when object deletion fails', async () => {
    const harness = createHarness({ storageDeleteFails: true })
    await harness.service.upload({
      date: PHOTO_DATE,
      mealType: 'snack',
      contentType: 'image/png',
      bytes: new Uint8Array([3, 2, 1]),
    })
    const result = await harness.service.delete('meal_photo_fixture')

    expect(captureDeleteState(result, harness)).toEqual({
      result: {
        status: 'error',
        code: 'meal_photo/storage_failed',
        message: 'delete failed',
      },
      metadata: [
        {
          id: 'meal_photo_fixture',
          date: PHOTO_DATE,
          mealType: 'snack',
          objectKey: 'meal-photos/meal_photo_fixture',
          contentType: 'image/png',
          createdAt: CREATED_AT,
        },
      ],
      metadataCount: 1,
      objectCount: 1,
    })
  })

  it('reports a consistency error when metadata restoration also fails', async () => {
    const harness = createHarness({
      restorationFails: true,
      storageDeleteFails: true,
    })
    await harness.service.upload({
      date: PHOTO_DATE,
      mealType: 'snack',
      contentType: 'image/png',
      bytes: new Uint8Array([3, 2, 1]),
    })
    const result = await harness.service.delete('meal_photo_fixture')

    expect(captureDeleteState(result, harness)).toEqual({
      result: {
        status: 'error',
        code: 'meal_photo/consistency_failed',
        message:
          'failed to restore photo metadata after object deletion failed',
      },
      metadata: [],
      metadataCount: 0,
      objectCount: 1,
    })
  })
})
