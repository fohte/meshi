import type { UserProfile } from '@/domain/user-profile/user-profile'

export interface UserProfilePayload {
  readonly likes: ReadonlyArray<string>
  readonly dislikes: ReadonlyArray<string>
  readonly allergies: ReadonlyArray<string>
  readonly constraints: ReadonlyArray<string>
  readonly daily_targets?: Readonly<Record<string, number>>
}

export const toUserProfilePayload = (
  profile: UserProfile,
): UserProfilePayload => ({
  likes: profile.likes,
  dislikes: profile.dislikes,
  allergies: profile.allergies,
  constraints: profile.constraints,
  ...(profile.dailyTargets === undefined
    ? {}
    : { daily_targets: profile.dailyTargets }),
})
