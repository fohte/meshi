import { describe, expect, it } from 'vitest'

import type {
  UserProfile,
  UserProfilePatch,
} from '@/domain/user-profile/user-profile'
import type { UserProfileService } from '@/domain/user-profile/user-profile-service'
import { normalizeResult } from '@/llm/domain-tools/test-helpers'
import { createGetUserProfileTool } from '@/llm/domain-tools/tools/get-user-profile'
import { createUpdateUserProfileTool } from '@/llm/domain-tools/tools/update-user-profile'

const PROFILE: UserProfile = {
  likes: ['banana'],
  dislikes: ['natto'],
  allergies: ['shrimp'],
  constraints: ['low-sodium'],
  dailyTargets: { energy_kcal: 2000 },
}

interface Calls {
  get: number
  update: UserProfilePatch[]
}

const setup = (
  override: Partial<UserProfileService> = {},
): {
  service: UserProfileService
  calls: Calls
} => {
  const calls: Calls = { get: 0, update: [] }
  const service: UserProfileService = {
    get: () => {
      calls.get += 1
      return Promise.resolve(PROFILE)
    },
    update: (patch) => {
      calls.update.push(patch)
      return Promise.resolve({ ...PROFILE, ...patch })
    },
    ...override,
  }
  return { service, calls }
}

describe('get_user_profile tool', () => {
  it('returns the current profile in snake_case', async () => {
    const { service, calls } = setup()
    const tool = createGetUserProfileTool(service)

    const result = await tool.execute({})

    expect({ result: normalizeResult(result), calls }).toEqual({
      result: {
        ok: true,
        value: {
          likes: ['banana'],
          dislikes: ['natto'],
          allergies: ['shrimp'],
          constraints: ['low-sodium'],
          daily_targets: { energy_kcal: 2000 },
        },
      },
      calls: { get: 1, update: [] },
    })
  })

  it('rejects unknown input fields with invalid_input', async () => {
    const { service, calls } = setup()
    const tool = createGetUserProfileTool(service)
    const result = await tool.execute({ unexpected: true })
    expect({ result: normalizeResult(result), calls }).toEqual({
      result: {
        ok: false,
        error: {
          code: 'invalid_input',
          message: '<dynamic>',
          details: { issues: { count: 1 } },
        },
      },
      calls: { get: 0, update: [] },
    })
  })
})

describe('update_user_profile tool', () => {
  it('forwards only provided fields as a patch and returns the merged profile', async () => {
    const { service, calls } = setup({
      update: (patch) => {
        calls.update.push(patch)
        return Promise.resolve({
          ...PROFILE,
          likes: patch.likes ?? PROFILE.likes,
        })
      },
    })
    const tool = createUpdateUserProfileTool(service)

    const result = await tool.execute({ likes: ['mango'] })

    expect({ result: normalizeResult(result), calls }).toEqual({
      result: {
        ok: true,
        value: {
          likes: ['mango'],
          dislikes: ['natto'],
          allergies: ['shrimp'],
          constraints: ['low-sodium'],
          daily_targets: { energy_kcal: 2000 },
        },
      },
      calls: { get: 0, update: [{ likes: ['mango'] }] },
    })
  })

  it('sends an empty patch when no fields are supplied', async () => {
    const { service, calls } = setup({
      update: (patch) => {
        calls.update.push(patch)
        return Promise.resolve(PROFILE)
      },
    })
    const tool = createUpdateUserProfileTool(service)

    await tool.execute({})

    expect(calls.update).toEqual([{}])
  })

  it('translates daily_targets snake_case to dailyTargets in the patch', async () => {
    const { service, calls } = setup({
      update: (patch) => {
        calls.update.push(patch)
        return Promise.resolve({
          ...PROFILE,
          dailyTargets: { ...PROFILE.dailyTargets, ...patch.dailyTargets },
        })
      },
    })
    const tool = createUpdateUserProfileTool(service)

    await tool.execute({ daily_targets: { protein_g: 80 } })

    expect(calls.update).toEqual([{ dailyTargets: { protein_g: 80 } }])
  })

  it('rejects empty strings inside likes with invalid_input', async () => {
    const { service, calls } = setup()
    const tool = createUpdateUserProfileTool(service)
    const result = await tool.execute({ likes: ['banana', ''] })

    expect({ result: normalizeResult(result), calls }).toEqual({
      result: {
        ok: false,
        error: {
          code: 'invalid_input',
          message: '<dynamic>',
          details: { issues: { count: 1 } },
        },
      },
      calls: { get: 0, update: [] },
    })
  })
})
