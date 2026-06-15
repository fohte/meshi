import {
  DEFAULT_USER_PROFILE,
  mergeUserProfile,
  type UserProfile,
  type UserProfilePatch,
} from '@/domain/user-profile/user-profile'
import type { UserProfileRepository } from '@/domain/user-profile/user-profile-repository'

export interface UserProfileService {
  get(): Promise<UserProfile>
  update(patch: UserProfilePatch): Promise<UserProfile>
}

export const createUserProfileService = (
  repository: UserProfileRepository,
): UserProfileService => {
  const loadOrDefault = async (): Promise<UserProfile> =>
    (await repository.load()) ?? DEFAULT_USER_PROFILE

  return {
    get: loadOrDefault,
    async update(patch) {
      const current = await loadOrDefault()
      const next = mergeUserProfile(current, patch)
      return repository.save(next)
    },
  }
}
