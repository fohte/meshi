import type { Result } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  deleteMealPhoto,
  fetchMealPhotos,
  MealPhotoRequestError,
  uploadMealPhoto,
} from '#api/meal-photos'

const PHOTO = {
  id: 'meal_photo_one',
  date: '2026-07-29',
  mealType: 'lunch',
  contentType: 'image/jpeg',
  createdAt: '2026-07-29T03:00:01.000Z',
  contentUrl: '/api/meal-photos/meal_photo_one/content',
} as const

const outcomeOf = (result: Result<unknown, Error>): unknown =>
  result.match(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error: error.message }),
  )

const describeApiCall = (
  calls: ReadonlyArray<Parameters<typeof fetch>>,
  result: Result<unknown, Error>,
): unknown => ({
  calls: calls.map(([input, init]) => ({
    input,
    method: init?.method,
    headers: init?.headers,
    photo: init?.body instanceof FormData ? init.body.get('photo') : undefined,
  })),
  outcome: outcomeOf(result),
})

const describeUploadError = (error: Error) => ({
  name: error.name,
  message: error.message,
  status: error instanceof MealPhotoRequestError ? error.status : undefined,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchMealPhotos', () => {
  it('parses the photo list for a meal', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([PHOTO]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMealPhotos('2026-07-29', 'lunch')

    expect(describeApiCall(fetchMock.mock.calls, result)).toEqual({
      calls: [
        {
          input: '/api/meal-photos/2026-07-29/lunch',
          method: undefined,
          headers: undefined,
          photo: undefined,
        },
      ],
      outcome: { ok: true, value: [PHOTO] },
    })
  })
})

describe('uploadMealPhoto', () => {
  it('sends the photo as multipart form data and parses the response', async () => {
    const photoFile = new File(['image bytes'], 'photo.jpg', {
      type: 'image/jpeg',
    })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(PHOTO), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadMealPhoto('2026-07-29', 'lunch', photoFile)
    expect(describeApiCall(fetchMock.mock.calls, result)).toEqual({
      calls: [
        {
          input: '/api/meal-photos/2026-07-29/lunch',
          method: 'POST',
          headers: undefined,
          photo: photoFile,
        },
      ],
      outcome: { ok: true, value: PHOTO },
    })
  })

  it('preserves an upload rejection status for user-facing errors', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'photo must not exceed 10 MiB' }), {
        status: 413,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadMealPhoto(
      '2026-07-29',
      'lunch',
      new File(['image bytes'], 'photo.jpg', { type: 'image/jpeg' }),
    )
    const error = result._unsafeUnwrapErr()

    expect(describeUploadError(error)).toEqual({
      name: 'MealPhotoRequestError',
      message: '/api/meal-photos/2026-07-29/lunch responded with 413',
      status: 413,
    })
  })
})

describe('deleteMealPhoto', () => {
  it('deletes the photo without parsing the empty response body', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await deleteMealPhoto('meal/photo one')

    expect(describeApiCall(fetchMock.mock.calls, result)).toEqual({
      calls: [
        {
          input: '/api/meal-photos/meal%2Fphoto%20one',
          method: 'DELETE',
          headers: undefined,
          photo: undefined,
        },
      ],
      outcome: { ok: true, value: undefined },
    })
  })
})
