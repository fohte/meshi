import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { mountMealPhotoRoutes } from '#api/meal-photo-routes'
import { MealPhotoPersistenceError } from '#domain/meal-photo/errors'
import type { MealPhotoService } from '#domain/meal-photo/meal-photo-service'
import type { MealPhotoContent, MealPhotoRow } from '#domain/meal-photo/types'
import { jstDate } from '#test/jst-date'

const SAMPLE_PHOTO: MealPhotoRow = {
  id: 'meal_photo_fixture',
  date: jstDate('2099-03-15'),
  mealType: 'breakfast',
  objectKey: 'meal-photos/meal_photo_fixture',
  contentType: 'image/png',
  createdAt: new Date('2099-03-15T00:00:00.000Z'),
}

const SAMPLE_PHOTO_JSON = {
  id: 'meal_photo_fixture',
  date: '2099-03-15',
  mealType: 'breakfast',
  contentType: 'image/png',
  createdAt: '2099-03-15T00:00:00.000Z',
  contentUrl: '/api/meal-photos/meal_photo_fixture/content',
}

const buildApp = (service: MealPhotoService): Hono => {
  const app = new Hono()
  mountMealPhotoRoutes(app, service)
  return app
}

const notStubbed = (): MealPhotoService => ({
  upload: () =>
    errAsync(
      new MealPhotoPersistenceError('mealPhotoService.upload not stubbed'),
    ),
  listForMeal: () =>
    errAsync(
      new MealPhotoPersistenceError('mealPhotoService.listForMeal not stubbed'),
    ),
  getContent: () =>
    errAsync(
      new MealPhotoPersistenceError('mealPhotoService.getContent not stubbed'),
    ),
  delete: () =>
    errAsync(
      new MealPhotoPersistenceError('mealPhotoService.delete not stubbed'),
    ),
})

const captureJsonResponse = async (response: Response) => ({
  status: response.status,
  body: await response.json(),
})

const captureJsonResponseWith = async <Details extends object>(
  response: Response,
  details: Details,
) => ({ ...(await captureJsonResponse(response)), ...details })

const captureImageResponse = async (response: Response) => ({
  status: response.status,
  contentType: response.headers.get('content-type'),
  cacheControl: response.headers.get('cache-control'),
  nosniff: response.headers.get('x-content-type-options'),
  bytes: [...new Uint8Array(await response.arrayBuffer())],
})

const captureStatusResponseWith = <Details extends object>(
  response: Response,
  details: Details,
) => ({ status: response.status, ...details })

describe('GET /api/meal-photos/:date/:mealType', () => {
  it('returns the photos for a meal with their content URLs', async () => {
    let captured: unknown
    const app = buildApp({
      ...notStubbed(),
      listForMeal: (date, mealType) => {
        captured = { date, mealType }
        return okAsync([SAMPLE_PHOTO])
      },
    })

    const response = await app.request('/api/meal-photos/2099-03-15/breakfast')

    expect(await captureJsonResponseWith(response, { captured })).toEqual({
      status: 200,
      body: [SAMPLE_PHOTO_JSON],
      captured: { date: '2099-03-15', mealType: 'breakfast' },
    })
  })

  it('returns 400 when the meal date is invalid', async () => {
    const response = await buildApp(notStubbed()).request(
      '/api/meal-photos/2099-02-30/breakfast',
    )

    expect(await captureJsonResponse(response)).toEqual({
      status: 400,
      body: {
        error:
          'must be a valid YYYY-MM-DD JST calendar date, got: "2099-02-30"',
      },
    })
  })
})

describe('POST /api/meal-photos/:date/:mealType', () => {
  it('stores one multipart photo and returns its content URL', async () => {
    let captured: unknown
    const app = buildApp({
      ...notStubbed(),
      upload: (input) => {
        captured = {
          date: input.date,
          mealType: input.mealType,
          contentType: input.contentType,
          bytes: [...input.bytes],
        }
        return okAsync(SAMPLE_PHOTO)
      },
    })
    const form = new FormData()
    form.set(
      'photo',
      new File([new Uint8Array([80, 78, 71])], 'sample.png', {
        type: 'image/png',
      }),
    )

    const response = await app.request(
      '/api/meal-photos/2099-03-15/breakfast',
      { method: 'POST', body: form },
    )

    expect(await captureJsonResponseWith(response, { captured })).toEqual({
      status: 201,
      body: SAMPLE_PHOTO_JSON,
      captured: {
        date: '2099-03-15',
        mealType: 'breakfast',
        contentType: 'image/png',
        bytes: [80, 78, 71],
      },
    })
  })

  it('rejects a non-image content type before calling the service', async () => {
    let uploadCalled = false
    const form = new FormData()
    form.set(
      'photo',
      new File([new Uint8Array([1])], 'sample.gif', { type: 'image/gif' }),
    )
    const app = buildApp({
      ...notStubbed(),
      upload: () => {
        uploadCalled = true
        return okAsync(SAMPLE_PHOTO)
      },
    })

    const response = await app.request(
      '/api/meal-photos/2099-03-15/breakfast',
      { method: 'POST', body: form },
    )

    expect(await captureJsonResponseWith(response, { uploadCalled })).toEqual({
      status: 400,
      body: {
        error:
          'photo content type must be one of: image/jpeg, image/png, image/webp',
      },
      uploadCalled: false,
    })
  })

  it('rejects a photo larger than 10 MiB', async () => {
    const form = new FormData()
    form.set(
      'photo',
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', {
        type: 'image/png',
      }),
    )

    const response = await buildApp(notStubbed()).request(
      '/api/meal-photos/2099-03-15/breakfast',
      { method: 'POST', body: form },
    )

    expect(await captureJsonResponse(response)).toEqual({
      status: 413,
      body: { error: 'photo must not exceed 10 MiB' },
    })
  })
})

describe('GET /api/meal-photos/:id/content', () => {
  it('returns the stored bytes with a private image response', async () => {
    const content: MealPhotoContent = {
      photo: SAMPLE_PHOTO,
      bytes: new Uint8Array([80, 78, 71]),
    }
    const app = buildApp({
      ...notStubbed(),
      getContent: () => okAsync(content),
    })

    const response = await app.request(
      '/api/meal-photos/meal_photo_fixture/content',
    )

    expect(await captureImageResponse(response)).toEqual({
      status: 200,
      contentType: 'image/png',
      cacheControl: 'private, no-store',
      nosniff: 'nosniff',
      bytes: [80, 78, 71],
    })
  })
})

describe('DELETE /api/meal-photos/:id', () => {
  it('returns 204 when the photo is deleted', async () => {
    let captured: unknown
    const app = buildApp({
      ...notStubbed(),
      delete: (id) => {
        captured = id
        return okAsync(undefined)
      },
    })

    const response = await app.request('/api/meal-photos/meal_photo_fixture', {
      method: 'DELETE',
    })

    expect(captureStatusResponseWith(response, { captured })).toEqual({
      status: 204,
      captured: 'meal_photo_fixture',
    })
  })
})
