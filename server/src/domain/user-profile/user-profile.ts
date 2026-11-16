type NutritionTargets = Readonly<Record<string, number>>

export interface UserProfile {
  readonly likes: ReadonlyArray<string>
  readonly dislikes: ReadonlyArray<string>
  readonly allergies: ReadonlyArray<string>
  readonly constraints: ReadonlyArray<string>
  readonly dailyTargets?: NutritionTargets
  readonly goalWeightKg?: number
}

// dailyTargets accepts null to mean "clear the field"; the other keys keep
// the Partial<UserProfile> semantics of "omit = keep current".
export type UserProfilePatch = Omit<
  Partial<UserProfile>,
  'dailyTargets' | 'goalWeightKg'
> & {
  readonly dailyTargets?: NutritionTargets | null
  readonly goalWeightKg?: number | null
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  likes: [],
  dislikes: [],
  allergies: [],
  constraints: [],
}

export const mergeUserProfile = (
  current: UserProfile,
  patch: UserProfilePatch,
): UserProfile => {
  const next: {
    -readonly [K in keyof UserProfile]: UserProfile[K]
  } = { ...current }
  if (patch.likes !== undefined) next.likes = patch.likes
  if (patch.dislikes !== undefined) next.dislikes = patch.dislikes
  if (patch.allergies !== undefined) next.allergies = patch.allergies
  if (patch.constraints !== undefined) next.constraints = patch.constraints
  if (patch.dailyTargets === null) {
    delete next.dailyTargets
  } else if (patch.dailyTargets !== undefined) {
    next.dailyTargets = { ...current.dailyTargets, ...patch.dailyTargets }
  }
  if (patch.goalWeightKg === null) {
    delete next.goalWeightKg
  } else if (patch.goalWeightKg !== undefined) {
    next.goalWeightKg = patch.goalWeightKg
  }
  return next
}
