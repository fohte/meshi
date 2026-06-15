import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { z } from 'zod'

import type { Sql } from '@/db'
import { userProfiles } from '@/db/schema'
import type { UserProfile } from '@/domain/user-profile/user-profile'
import type { UserProfileRepository } from '@/domain/user-profile/user-profile-repository'

const SINGLETON_ID = 1

type Db = ReturnType<typeof drizzle>

const nutritionTargetsSchema = z.record(z.string(), z.number())

export class UserProfileRowInvalidError extends Error {
  constructor(
    message: string,
    public readonly issues: z.core.$ZodIssue[],
  ) {
    super(message)
    this.name = 'UserProfileRowInvalidError'
  }
}

const toDomain = (row: typeof userProfiles.$inferSelect): UserProfile => {
  const base = {
    likes: row.likes,
    dislikes: row.dislikes,
    allergies: row.allergies,
    constraints: row.constraints,
  }
  if (row.dailyTargets === null) return base
  const parsed = nutritionTargetsSchema.safeParse(row.dailyTargets)
  if (!parsed.success) {
    throw new UserProfileRowInvalidError(
      'user_profiles.daily_targets is not a Record<string, number>',
      parsed.error.issues,
    )
  }
  return { ...base, dailyTargets: parsed.data }
}

export const createDrizzleUserProfileRepository = (
  sql: Sql,
): UserProfileRepository => {
  const db: Db = drizzle(sql)

  return {
    async load() {
      const rows = await db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.id, SINGLETON_ID))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : toDomain(row)
    },

    async save(profile) {
      const values = {
        id: SINGLETON_ID,
        likes: [...profile.likes],
        dislikes: [...profile.dislikes],
        allergies: [...profile.allergies],
        constraints: [...profile.constraints],
        dailyTargets: profile.dailyTargets ?? null,
        updatedAt: new Date(),
      }
      const rows = await db
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
        .returning()
      const row = rows[0]
      if (row === undefined) {
        throw new Error('user_profiles upsert returned no row')
      }
      return toDomain(row)
    },
  }
}
