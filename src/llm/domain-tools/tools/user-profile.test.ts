import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { NUTRIENT_CODES } from '#db/seed/nutrient-definitions'
import type {
  UserProfile,
  UserProfilePatch,
} from '#domain/user-profile/user-profile'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'
import { normalizeResult } from '#llm/domain-tools/test-helpers'
import { createGetUserProfileTool } from '#llm/domain-tools/tools/get-user-profile'
import { createUpdateUserProfileTool } from '#llm/domain-tools/tools/update-user-profile'

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
      return okAsync(PROFILE)
    },
    update: (patch) => {
      calls.update.push(patch)
      const { dailyTargets, ...rest } = patch
      const base = { ...PROFILE, ...rest }
      if (dailyTargets === null) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure to drop the field from the rest spread.
        const { dailyTargets: _drop, ...cleared } = base
        return okAsync(cleared)
      }
      if (dailyTargets !== undefined) {
        return okAsync({ ...base, dailyTargets })
      }
      return okAsync(base)
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

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: {
        likes: ['banana'],
        dislikes: ['natto'],
        allergies: ['shrimp'],
        constraints: ['low-sodium'],
        daily_targets: { energy_kcal: 2000 },
      },
    })
    expect(calls).toEqual({ get: 1, update: [] })
  })

  it('rejects unknown input fields with invalid_input', async () => {
    const { service, calls } = setup()
    const tool = createGetUserProfileTool(service)
    const result = await tool.execute({ unexpected: true })
    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 1 } },
      },
    })
    expect(calls).toEqual({ get: 0, update: [] })
  })
})

describe('update_user_profile tool', () => {
  it('exposes the registered nutrient codes as a closed enum in daily_targets so the LLM never has to guess one', () => {
    const { service } = setup()
    const tool = createUpdateUserProfileTool(service)

    expect(tool.inputSchema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        likes: { type: 'array', items: { type: 'string', minLength: 1 } },
        dislikes: { type: 'array', items: { type: 'string', minLength: 1 } },
        allergies: { type: 'array', items: { type: 'string', minLength: 1 } },
        constraints: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        daily_targets: {
          type: 'object',
          propertyNames: { type: 'string', enum: [...NUTRIENT_CODES] },
          additionalProperties: { type: 'number' },
        },
      },
    })
  })

  it('forwards only provided fields as a patch and returns the merged profile', async () => {
    const { service, calls } = setup({
      update: (patch) => {
        calls.update.push(patch)
        return okAsync({
          ...PROFILE,
          likes: patch.likes ?? PROFILE.likes,
        })
      },
    })
    const tool = createUpdateUserProfileTool(service)

    const result = await tool.execute({ likes: ['mango'] })

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: {
        likes: ['mango'],
        dislikes: ['natto'],
        allergies: ['shrimp'],
        constraints: ['low-sodium'],
        daily_targets: { energy_kcal: 2000 },
      },
    })
    expect(calls).toEqual({ get: 0, update: [{ likes: ['mango'] }] })
  })

  it('sends an empty patch when no fields are supplied and echoes the current profile', async () => {
    const { service, calls } = setup({
      update: (patch) => {
        calls.update.push(patch)
        return okAsync(PROFILE)
      },
    })
    const tool = createUpdateUserProfileTool(service)

    const result = await tool.execute({})

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: {
        likes: ['banana'],
        dislikes: ['natto'],
        allergies: ['shrimp'],
        constraints: ['low-sodium'],
        daily_targets: { energy_kcal: 2000 },
      },
    })
    expect(calls).toEqual({ get: 0, update: [{}] })
  })

  it('translates daily_targets snake_case to dailyTargets in the patch', async () => {
    const { service, calls } = setup({
      update: (patch) => {
        calls.update.push(patch)
        return okAsync({
          ...PROFILE,
          dailyTargets: { ...PROFILE.dailyTargets, ...patch.dailyTargets },
        })
      },
    })
    const tool = createUpdateUserProfileTool(service)

    const result = await tool.execute({ daily_targets: { protein_g: 80 } })

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: {
        likes: ['banana'],
        dislikes: ['natto'],
        allergies: ['shrimp'],
        constraints: ['low-sodium'],
        daily_targets: { energy_kcal: 2000, protein_g: 80 },
      },
    })
    expect(calls).toEqual({
      get: 0,
      update: [{ dailyTargets: { protein_g: 80 } }],
    })
  })

  it('rejects empty strings inside likes with invalid_input', async () => {
    const { service, calls } = setup()
    const tool = createUpdateUserProfileTool(service)
    const result = await tool.execute({ likes: ['banana', ''] })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 1 } },
      },
    })
    expect(calls).toEqual({ get: 0, update: [] })
  })
})
