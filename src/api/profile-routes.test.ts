import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { mountProfileRoutes } from '#api/profile-routes'
import { UserProfileRepositoryError } from '#domain/user-profile/errors'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'

const buildApp = (userProfileService: UserProfileService): Hono => {
  const app = new Hono()
  mountProfileRoutes(app, userProfileService)
  return app
}

const noopUpdate: UserProfileService['update'] = () =>
  okAsync({ likes: [], dislikes: [], allergies: [], constraints: [] })

describe('GET /api/profile', () => {
  it('defaults dailyTargets to null when unset', async () => {
    const app = buildApp({
      get: () =>
        okAsync({
          likes: ['ramen'],
          dislikes: [],
          allergies: [],
          constraints: [],
        }),
      update: noopUpdate,
    })

    const res = await app.request('/api/profile')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      likes: ['ramen'],
      dislikes: [],
      allergies: [],
      constraints: [],
      dailyTargets: null,
    })
  })

  it('returns dailyTargets when set', async () => {
    const app = buildApp({
      get: () =>
        okAsync({
          likes: [],
          dislikes: [],
          allergies: [],
          constraints: [],
          dailyTargets: { energy_kcal: 2000 },
        }),
      update: noopUpdate,
    })

    const res = await app.request('/api/profile')

    expect(await res.json()).toEqual({
      likes: [],
      dislikes: [],
      allergies: [],
      constraints: [],
      dailyTargets: { energy_kcal: 2000 },
    })
  })

  it('returns 500 when the service fails', async () => {
    const app = buildApp({
      get: () => errAsync(new UserProfileRepositoryError('boom')),
      update: noopUpdate,
    })

    const res = await app.request('/api/profile')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})
