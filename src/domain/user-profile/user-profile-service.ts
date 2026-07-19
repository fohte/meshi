import { okAsync, type ResultAsync } from 'neverthrow'

import type { UserProfileRepositoryError } from '@/domain/user-profile/errors'
import {
  DEFAULT_USER_PROFILE,
  mergeUserProfile,
  type UserProfile,
  type UserProfilePatch,
} from '@/domain/user-profile/user-profile'
import type { UserProfileRepository } from '@/domain/user-profile/user-profile-repository'

export interface UserProfileService {
  get(): ResultAsync<UserProfile, UserProfileRepositoryError>
  update(
    patch: UserProfilePatch,
  ): ResultAsync<UserProfile, UserProfileRepositoryError>
}

export const createUserProfileService = (
  repository: UserProfileRepository,
): UserProfileService => {
  const loadOrDefault = (): ResultAsync<
    UserProfile,
    UserProfileRepositoryError
  > => repository.load().map((profile) => profile ?? DEFAULT_USER_PROFILE)

  return {
    get: loadOrDefault,
    update(patch) {
      return loadOrDefault().andThen((current) => {
        // Skip the save round-trip when the patch carries no fields; mergeUserProfile
        // would still return an equivalent profile, but writing it would bump updated_at.
        if (Object.keys(patch).length === 0) return okAsync(current)
        return repository.save(mergeUserProfile(current, patch))
      })
    },
  }
}
