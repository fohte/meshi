import { type Result } from 'neverthrow'
import { expect, it } from 'vitest'

import { createDrizzleMealPhotoRepository } from '#domain/meal-photo/drizzle-meal-photo-repository'
import type { MealPhotoDomainError } from '#domain/meal-photo/errors'
import type { MealPhotoRow } from '#domain/meal-photo/types'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import { seedMealPhoto } from '#test/seed'

const captureDeleteResults = (
  deleted: Result<MealPhotoRow | null, MealPhotoDomainError>,
  remaining: Result<MealPhotoRow | null, MealPhotoDomainError>,
) => ({
  deleted: deleted.match(
    (row) => ({ status: 'ok', row }),
    (error) => ({ status: 'error', code: error.code }),
  ),
  remaining: remaining.match(
    (row) => ({ status: 'ok', row }),
    (error) => ({ status: 'error', code: error.code }),
  ),
})

describeIfDb('createDrizzleMealPhotoRepository', () => {
  const getTx = setupDrizzleTx()

  it('lists only photos for the requested meal in creation order', async () => {
    const tx = getTx()
    const repository = createDrizzleMealPhotoRepository(tx)
    await seedMealPhoto(tx, {
      id: 'meal_photo_later',
      eatenDate: jstDate('2099-03-15'),
      mealType: 'breakfast',
      objectKey: 'meal-photos/later',
      contentType: 'image/png',
      createdAt: new Date('2099-03-15T02:00:00.000Z'),
    })
    await seedMealPhoto(tx, {
      id: 'meal_photo_earlier',
      eatenDate: jstDate('2099-03-15'),
      mealType: 'breakfast',
      objectKey: 'meal-photos/earlier',
      contentType: 'image/jpeg',
      createdAt: new Date('2099-03-15T01:00:00.000Z'),
    })
    await seedMealPhoto(tx, {
      id: 'meal_photo_other_meal',
      eatenDate: jstDate('2099-03-15'),
      mealType: 'lunch',
      objectKey: 'meal-photos/other-meal',
      contentType: 'image/webp',
    })

    const result = await repository.findForMeal(
      jstDate('2099-03-15'),
      'breakfast',
    )

    expect(
      result.match(
        (rows) => ({ status: 'ok', rows }),
        (error) => ({ status: 'error', code: error.code }),
      ),
    ).toEqual({
      status: 'ok',
      rows: [
        {
          id: 'meal_photo_earlier',
          date: jstDate('2099-03-15'),
          mealType: 'breakfast',
          objectKey: 'meal-photos/earlier',
          contentType: 'image/jpeg',
          createdAt: new Date('2099-03-15T01:00:00.000Z'),
        },
        {
          id: 'meal_photo_later',
          date: jstDate('2099-03-15'),
          mealType: 'breakfast',
          objectKey: 'meal-photos/later',
          contentType: 'image/png',
          createdAt: new Date('2099-03-15T02:00:00.000Z'),
        },
      ],
    })
  })

  it('returns the deleted row and removes it from later lookups', async () => {
    const tx = getTx()
    const repository = createDrizzleMealPhotoRepository(tx)
    await seedMealPhoto(tx, {
      id: 'meal_photo_to_delete',
      eatenDate: jstDate('2099-03-15'),
      mealType: 'dinner',
      objectKey: 'meal-photos/delete-me',
      contentType: 'image/png',
      createdAt: new Date('2099-03-15T03:00:00.000Z'),
    })

    const deleted = await repository.deleteById('meal_photo_to_delete')
    const remaining = await repository.findById('meal_photo_to_delete')

    expect(captureDeleteResults(deleted, remaining)).toEqual({
      deleted: {
        status: 'ok',
        row: {
          id: 'meal_photo_to_delete',
          date: jstDate('2099-03-15'),
          mealType: 'dinner',
          objectKey: 'meal-photos/delete-me',
          contentType: 'image/png',
          createdAt: new Date('2099-03-15T03:00:00.000Z'),
        },
      },
      remaining: { status: 'ok', row: null },
    })
  })
})
