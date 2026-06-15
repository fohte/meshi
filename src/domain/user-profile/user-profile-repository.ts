import type { UserProfile } from '@/domain/user-profile/user-profile'

export interface UserProfileRepository {
  load(): Promise<UserProfile | null>
  save(profile: UserProfile): Promise<UserProfile>
}
