import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { err, ok, type Result, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '@/db'
import { userProfiles } from '@/db/schema'
import { UserProfileRepositoryError } from '@/domain/user-profile/errors'
import type { UserProfile } from '@/domain/user-profile/user-profile'
import type { UserProfileRepository } from '@/domain/user-profile/user-profile-repository'

const SINGLETON_ID = 1

type Db = ReturnType<typeof drizzle>

const nutritionTargetsSchema = z.record(z.string(), z.number())

export class UserProfileRowInvalidError extends UserProfileRepositoryError {
  constructor(
    message: string,
    public readonly issues: z.core.$ZodIssue[],
  ) {
    super(message)
    this.name = 'UserProfileRowInvalidError'
  }
}

const toDomain = (
  row: typeof userProfiles.$inferSelect,
): Result<UserProfile, UserProfileRowInvalidError> => {
  const base = {
    likes: row.likes,
    dislikes: row.dislikes,
    allergies: row.allergies,
    constraints: row.constraints,
  }
  if (row.dailyTargets === null) return ok(base)
  const parsed = nutritionTargetsSchema.safeParse(row.dailyTargets)
  if (!parsed.success) {
    return err(
      new UserProfileRowInvalidError(
        'user_profiles.daily_targets is not a Record<string, number>',
        parsed.error.issues,
      ),
    )
  }
  return ok({ ...base, dailyTargets: parsed.data })
}

export const createDrizzleUserProfileRepository = (
  sql: Sql,
): UserProfileRepository => {
  const db: Db = drizzle(sql)

  return {
    load: () =>
      ResultAsync.fromPromise(
        db
          .select()
          .from(userProfiles)
          .where(eq(userProfiles.id, SINGLETON_ID))
          .limit(1),
        (caughtErr) =>
          new UserProfileRepositoryError(
            'failed to load user_profile',
            caughtErr,
          ),
      ).andThen((rows) => {
        const row = rows[0]
        return row === undefined ? ok(null) : toDomain(row)
      }),

    save: (profile) => {
      const values = {
        id: SINGLETON_ID,
        likes: [...profile.likes],
        dislikes: [...profile.dislikes],
        allergies: [...profile.allergies],
        constraints: [...profile.constraints],
        dailyTargets: profile.dailyTargets ?? null,
        updatedAt: new Date(),
      }
      return ResultAsync.fromPromise(
        db
          .insert(userProfiles)
          .values(values)
          .onConflictDoUpdate({
            target: userProfiles.id,
            set: {
              likes: values.likes,
              dislikes: values.dislikes,
              allergies: values.allergies,
              constraints: values.constraints,
              dailyTargets: values.dailyTargets,
              updatedAt: values.updatedAt,
            },
          })
          .returning(),
        (caughtErr) =>
          new UserProfileRepositoryError(
            'failed to save user_profile',
            caughtErr,
          ),
      ).andThen((rows) => {
        const row = rows[0]
        if (row === undefined) {
          return err(
            new UserProfileRepositoryError(
              'user_profiles upsert returned no row',
            ),
          )
        }
        return toDomain(row)
      })
    },
  }
}
