import type { ResultAsync } from 'neverthrow'

import type { UserProfileRepositoryError } from '@/domain/user-profile/errors'
import type { UserProfile } from '@/domain/user-profile/user-profile'

export interface UserProfileRepository {
  load(): ResultAsync<UserProfile | null, UserProfileRepositoryError>
  save(
    profile: UserProfile,
  ): ResultAsync<UserProfile, UserProfileRepositoryError>
}
