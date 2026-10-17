import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { MealPhotoStorageError } from '#domain/meal-photo/errors'
import type { MealPhotoObjectStore } from '#domain/meal-photo/meal-photo-object-store'

const commandOutputSchema = z.looseObject({
  $metadata: z.looseObject({ httpStatusCode: z.number().optional() }),
})

interface SdkObjectBody {
  transformToByteArray: () => Promise<Uint8Array>
}

const sdkObjectBodySchema = z.custom<SdkObjectBody>(
  (value): value is SdkObjectBody =>
    typeof value === 'object' &&
    value !== null &&
    'transformToByteArray' in value &&
    typeof value.transformToByteArray === 'function',
)

const getObjectOutputSchema = commandOutputSchema.extend({
  Body: sdkObjectBodySchema,
})

const toStorageError = (operation: string) => (error: unknown) =>
  new MealPhotoStorageError(`failed to ${operation} meal photo in R2`, error)

export const createMealPhotoObjectStore = (
  client: S3Client,
  bucketName: string,
): MealPhotoObjectStore => ({
  put(input) {
    return ResultAsync.fromPromise(
      client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: input.objectKey,
          Body: input.bytes,
          ContentType: input.contentType,
        }),
      ),
      toStorageError('upload'),
    ).andThen((response) => {
      const parsed = commandOutputSchema.safeParse(response)
      return parsed.success
        ? okAsync(undefined)
        : errAsync(
            new MealPhotoStorageError(
              'R2 returned an invalid upload response',
              parsed.error,
            ),
          )
    })
  },
  get(objectKey) {
    return ResultAsync.fromPromise(
      client.send(new GetObjectCommand({ Bucket: bucketName, Key: objectKey })),
      toStorageError('download'),
    ).andThen((response) => {
      const parsed = getObjectOutputSchema.safeParse(response)
      if (!parsed.success) {
        return errAsync(
          new MealPhotoStorageError(
            'R2 returned an invalid download response',
            parsed.error,
          ),
        )
      }
      return ResultAsync.fromPromise(
        parsed.data.Body.transformToByteArray(),
        toStorageError('read'),
      ).andThen((bytes) => {
        const parsedBytes = z.instanceof(Uint8Array).safeParse(bytes)
        return parsedBytes.success
          ? okAsync(parsedBytes.data)
          : errAsync(
              new MealPhotoStorageError('R2 returned invalid photo bytes'),
            )
      })
    })
  },
  delete(objectKey) {
    return ResultAsync.fromPromise(
      client.send(
        new DeleteObjectCommand({ Bucket: bucketName, Key: objectKey }),
      ),
      toStorageError('delete'),
    ).andThen((response) => {
      const parsed = commandOutputSchema.safeParse(response)
      return parsed.success
        ? okAsync(undefined)
        : errAsync(
            new MealPhotoStorageError(
              'R2 returned an invalid delete response',
              parsed.error,
            ),
          )
    })
  },
})
