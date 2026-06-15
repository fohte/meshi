import { describe, expect, it } from 'vitest'

import {
  DEFAULT_USER_PROFILE,
  type UserProfile,
} from '@/domain/user-profile/user-profile'
import type { UserProfileRepository } from '@/domain/user-profile/user-profile-repository'
import { createUserProfileService } from '@/domain/user-profile/user-profile-service'

const createInMemoryRepository = (
  initial: UserProfile | null = null,
): UserProfileRepository & { current: UserProfile | null } => {
  const state: { current: UserProfile | null } = { current: initial }
  return {
    get current() {
      return state.current
    },
    load() {
      return Promise.resolve(state.current)
    },
    save(profile) {
      state.current = profile
      return Promise.resolve(profile)
    },
  }
}

describe('createUserProfileService', () => {
  it('returns schema defaults when no row exists yet', async () => {
    const service = createUserProfileService(createInMemoryRepository())

    expect(await service.get()).toEqual({
      likes: [],
      dislikes: [],
      allergies: [],
      constraints: [],
    } satisfies UserProfile)
  })

  it('merges a partial update onto the defaults and persists the result', async () => {
    const repo = createInMemoryRepository()
    const service = createUserProfileService(repo)

    const updated = await service.update({
      likes: ['natto'],
      dailyTargets: { protein_g: 80 },
    })

    expect({ updated, stored: repo.current }).toEqual({
      updated: {
        likes: ['natto'],
        dislikes: [],
        allergies: [],
        constraints: [],
        dailyTargets: { protein_g: 80 },
      },
      stored: {
        likes: ['natto'],
        dislikes: [],
        allergies: [],
        constraints: [],
        dailyTargets: { protein_g: 80 },
      },
    })
  })

  it('leaves omitted fields untouched on partial update', async () => {
    const repo = createInMemoryRepository({
      likes: ['natto'],
      dislikes: ['cilantro'],
      allergies: ['peanuts'],
      constraints: ['halal'],
      dailyTargets: { protein_g: 80, energy_kcal: 2000 },
    })
    const service = createUserProfileService(repo)

    const updated = await service.update({ dislikes: ['liver'] })

    expect(updated).toEqual({
      likes: ['natto'],
      dislikes: ['liver'],
      allergies: ['peanuts'],
      constraints: ['halal'],
      dailyTargets: { protein_g: 80, energy_kcal: 2000 },
    } satisfies UserProfile)
  })

  it('treats an empty patch as a no-op that still returns the full profile', async () => {
    const stored: UserProfile = {
      likes: ['natto'],
      dislikes: [],
      allergies: [],
      constraints: [],
    }
    const repo = createInMemoryRepository(stored)
    const service = createUserProfileService(repo)

    expect(await service.update({})).toEqual(stored)
  })

  it('keeps dailyTargets unset when the patch never mentions it', async () => {
    const repo = createInMemoryRepository()
    const service = createUserProfileService(repo)

    const updated = await service.update({ allergies: ['shrimp'] })

    expect(updated).toEqual({
      likes: [],
      dislikes: [],
      allergies: ['shrimp'],
      constraints: [],
    } satisfies UserProfile)
  })

  it('exposes the same schema defaults as DEFAULT_USER_PROFILE for downstream callers', () => {
    expect(DEFAULT_USER_PROFILE).toEqual({
      likes: [],
      dislikes: [],
      allergies: [],
      constraints: [],
    } satisfies UserProfile)
  })
})
