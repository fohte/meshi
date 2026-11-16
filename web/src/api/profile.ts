import type { ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { ApiRequestError } from '#api/errors'
import { requestJson } from '#api/request'

const nutritionTargetsSchema = z.record(z.string(), z.number())

const userProfileSchema = z.object({
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  allergies: z.array(z.string()),
  constraints: z.array(z.string()),
  dailyTargets: nutritionTargetsSchema.nullable(),
  goalWeightKg: z.number().nullable(),
})

export type UserProfile = z.infer<typeof userProfileSchema>

export const PROFILE_QUERY_KEY = ['profile']

// Mirrors the server's UserProfilePatch semantics: omitted keys keep their
// current values, and nullable values clear them (see
// src/domain/user-profile/user-profile.ts).
export interface UserProfilePatch {
  likes?: ReadonlyArray<string>
  dislikes?: ReadonlyArray<string>
  allergies?: ReadonlyArray<string>
  constraints?: ReadonlyArray<string>
  dailyTargets?: Record<string, number> | null
  goalWeightKg?: number | null
}

export const fetchUserProfile = (): ResultAsync<UserProfile, ApiRequestError> =>
  requestJson('/api/profile', userProfileSchema)

export const patchUserProfile = (
  patch: UserProfilePatch,
): ResultAsync<UserProfile, ApiRequestError> =>
  requestJson('/api/profile', userProfileSchema, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
