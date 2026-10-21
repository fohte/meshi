import type { Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { jsonBadRequest, jsonServerError } from '#api/errors'
import { MEAL_TYPES } from '#domain/meal-log/types'
import type { MealPhotoDomainError } from '#domain/meal-photo/errors'
import type { MealPhotoService } from '#domain/meal-photo/meal-photo-service'
import {
  mealPhotoContentTypeSchema,
  type MealPhotoRow,
} from '#domain/meal-photo/types'
import { jstDateSchema } from '#lib/jst-date'

const MAX_PHOTO_SIZE = 10 * 1024 * 1024
const MAX_MULTIPART_OVERHEAD = 64 * 1024

const paramsSchema = z.object({
  date: jstDateSchema,
  mealType: z.enum(MEAL_TYPES),
})

const uploadFormSchema = z.object({ photo: z.instanceof(File) }).strict()

const parseMealParams = (
  c: Context,
): ResultAsync<z.infer<typeof paramsSchema>, Response> => {
  const parsed = paramsSchema.safeParse({
    date: c.req.param('date'),
    mealType: c.req.param('mealType'),
  })
  if (!parsed.success) {
    return errAsync(
      jsonBadRequest(
        c,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      ),
    )
  }
  return okAsync(parsed.data)
}

const parseUploadFile = (c: Context): ResultAsync<File, Response> =>
  ResultAsync.fromPromise(
    c.req.parseBody({ all: true }),
    () => new Error('request body must be valid multipart/form-data'),
  )
    .mapErr(() =>
      jsonBadRequest(c, 'request body must be valid multipart/form-data'),
    )
    .andThen((raw: unknown) => {
      const parsed = uploadFormSchema.safeParse(raw)
      if (!parsed.success) {
        return errAsync(
          jsonBadRequest(
            c,
            parsed.error.issues.map((issue) => issue.message).join('; '),
          ),
        )
      }
      if (parsed.data.photo.size === 0) {
        return errAsync(jsonBadRequest(c, 'photo must not be empty'))
      }
      if (parsed.data.photo.size > MAX_PHOTO_SIZE) {
        return errAsync(c.json({ error: 'photo must not exceed 10 MiB' }, 413))
      }
      return okAsync(parsed.data.photo)
    })

const toMealPhotoJson = (row: MealPhotoRow) => ({
  id: row.id,
  date: row.date,
  mealType: row.mealType,
  contentType: row.contentType,
  createdAt: row.createdAt.toISOString(),
  contentUrl: `/api/meal-photos/${encodeURIComponent(row.id)}/content`,
})

const mealPhotoErrorResponse = (
  c: Context,
  error: MealPhotoDomainError,
): Response => {
  if (error.code === 'meal_photo/not_found') {
    return c.json({ error: error.message }, 404)
  }
  if (error.code === 'meal_photo/invalid_date') {
    return jsonBadRequest(c, error.message)
  }
  return jsonServerError(c, error)
}

export const mountMealPhotoRoutes = (
  app: Hono,
  mealPhotoService: MealPhotoService,
): void => {
  app.get('/api/meal-photos/:id/content', async (c) => {
    const result = await mealPhotoService.getContent(c.req.param('id'))
    return result.match(
      ({ photo, bytes }) =>
        c.body(new Uint8Array(bytes), 200, {
          'cache-control': 'private, no-store',
          'content-type': photo.contentType,
          'x-content-type-options': 'nosniff',
        }),
      (error) => mealPhotoErrorResponse(c, error),
    )
  })

  app.get('/api/meal-photos/:date/:mealType', async (c) => {
    const params = await parseMealParams(c)
    if (params.isErr()) return params.error

    return mealPhotoService
      .listForMeal(params.value.date, params.value.mealType)
      .match(
        (photos) => c.json(photos.map(toMealPhotoJson)),
        (error) => mealPhotoErrorResponse(c, error),
      )
  })

  app.post(
    '/api/meal-photos/:date/:mealType',
    bodyLimit({
      maxSize: MAX_PHOTO_SIZE + MAX_MULTIPART_OVERHEAD,
      onError: (c) => c.json({ error: 'photo must not exceed 10 MiB' }, 413),
    }),
    async (c) => {
      const params = await parseMealParams(c)
      if (params.isErr()) return params.error

      const file = await parseUploadFile(c)
      if (file.isErr()) return file.error

      const contentType = mealPhotoContentTypeSchema.safeParse(
        file.value.type.toLowerCase(),
      )
      if (!contentType.success) {
        return jsonBadRequest(
          c,
          'photo content type must be one of: image/jpeg, image/png, image/webp',
        )
      }

      return ResultAsync.fromPromise(
        file.value.arrayBuffer(),
        (error) => new Error('failed to read uploaded photo', { cause: error }),
      ).match(
        (buffer) =>
          mealPhotoService
            .upload({
              date: params.value.date,
              mealType: params.value.mealType,
              contentType: contentType.data,
              bytes: new Uint8Array(buffer),
            })
            .match(
              (photo) => c.json(toMealPhotoJson(photo), 201),
              (error) => mealPhotoErrorResponse(c, error),
            ),
        (error) => jsonServerError(c, error),
      )
    },
  )

  app.delete('/api/meal-photos/:id', async (c) => {
    const result = await mealPhotoService.delete(c.req.param('id'))
    return result.match(
      () => c.body(null, 204),
      (error) => mealPhotoErrorResponse(c, error),
    )
  })
}
