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
})

export type UserProfile = z.infer<typeof userProfileSchema>

// Mirrors the server's UserProfilePatch semantics: an omitted key keeps the
// current value, and dailyTargets: null clears it (see
// src/domain/user-profile/user-profile.ts).
export interface UserProfilePatch {
  likes?: ReadonlyArray<string>
  dislikes?: ReadonlyArray<string>
  allergies?: ReadonlyArray<string>
  constraints?: ReadonlyArray<string>
  dailyTargets?: Record<string, number> | null
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
