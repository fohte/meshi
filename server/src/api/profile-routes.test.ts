import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { mountProfileRoutes } from '#api/profile-routes'
import { UserProfileRepositoryError } from '#domain/user-profile/errors'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'

const errorResponseSchema = z.object({ error: z.string() })
const captureOutput = <Output>(output: Output): Output => output

const buildApp = (userProfileService: UserProfileService): Hono => {
  const app = new Hono()
  mountProfileRoutes(app, userProfileService)
  return app
}

const DEFAULT_PROFILE = {
  likes: [],
  dislikes: [],
  allergies: [],
  constraints: [],
}

const noopUpdate: UserProfileService['update'] = () => okAsync(DEFAULT_PROFILE)

describe('GET /api/profile', () => {
  it('defaults unset optional profile values to null', async () => {
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
      goalWeightKg: null,
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
          goalWeightKg: 62.45,
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
      goalWeightKg: 62.45,
    })
  })

  it('returns 500 when the get fails', async () => {
    const app = buildApp({
      get: () => errAsync(new UserProfileRepositoryError('boom')),
      update: noopUpdate,
    })

    const res = await app.request('/api/profile')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})

describe('PATCH /api/profile', () => {
  const patchRequest = (body: unknown): Request =>
    new Request('http://localhost/api/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('forwards only the fields present in the body to the service', async () => {
    let capturedPatch: unknown
    const app = buildApp({
      get: () => okAsync(DEFAULT_PROFILE),
      update: (patch) => {
        capturedPatch = patch
        return okAsync(DEFAULT_PROFILE)
      },
    })

    const res = await app.request(
      patchRequest({
        likes: ['ramen'],
        dailyTargets: { energy_kcal: 2000 },
      }),
    )

    expect(res.status).toBe(200)
    expect(capturedPatch).toEqual({
      likes: ['ramen'],
      dailyTargets: { energy_kcal: 2000 },
    })
  })

  it('forwards a null dailyTargets to clear it', async () => {
    let capturedPatch: unknown
    const app = buildApp({
      get: () => okAsync(DEFAULT_PROFILE),
      update: (patch) => {
        capturedPatch = patch
        return okAsync(DEFAULT_PROFILE)
      },
    })

    const res = await app.request(patchRequest({ dailyTargets: null }))

    expect(capturedPatch).toEqual({ dailyTargets: null })
    expect(res.status).toBe(200)
  })

  it('forwards a null goalWeightKg to clear it', async () => {
    let capturedPatch: unknown
    const app = buildApp({
      get: () => okAsync(DEFAULT_PROFILE),
      update: (patch) => {
        capturedPatch = patch
        return okAsync(DEFAULT_PROFILE)
      },
    })

    const res = await app.request(patchRequest({ goalWeightKg: null }))

    expect(captureOutput({ status: res.status, patch: capturedPatch })).toEqual(
      {
        status: 200,
        patch: { goalWeightKg: null },
      },
    )
  })

  it('accepts goal weights at the supported range and precision', async () => {
    const app = buildApp({
      get: () => okAsync(DEFAULT_PROFILE),
      update: (patch) =>
        patch.goalWeightKg === null || patch.goalWeightKg === undefined
          ? okAsync(DEFAULT_PROFILE)
          : okAsync({ ...DEFAULT_PROFILE, goalWeightKg: patch.goalWeightKg }),
    })

    const responses = await Promise.all([
      app.request(patchRequest({ goalWeightKg: 20 })),
      app.request(patchRequest({ goalWeightKg: 300 })),
      app.request(patchRequest({ goalWeightKg: 62.45 })),
    ])

    expect(
      await Promise.all(
        responses.map(async (res) => ({
          status: res.status,
          body: await res.json(),
        })),
      ),
    ).toEqual([
      {
        status: 200,
        body: { ...DEFAULT_PROFILE, dailyTargets: null, goalWeightKg: 20 },
      },
      {
        status: 200,
        body: { ...DEFAULT_PROFILE, dailyTargets: null, goalWeightKg: 300 },
      },
      {
        status: 200,
        body: { ...DEFAULT_PROFILE, dailyTargets: null, goalWeightKg: 62.45 },
      },
    ])
  })

  it.each([19.99, 300.01, 20.001])(
    'rejects goalWeightKg %s with a bad request',
    async (goalWeightKg) => {
      const app = buildApp({
        get: () => okAsync(DEFAULT_PROFILE),
        update: noopUpdate,
      })

      const res = await app.request(patchRequest({ goalWeightKg }))
      const body = await res.json()

      expect(
        captureOutput({
          status: res.status,
          errorResponseValid: errorResponseSchema.safeParse(body).success,
        }),
      ).toEqual({ status: 400, errorResponseValid: true })
    },
  )

  it('returns the updated profile from the service', async () => {
    const app = buildApp({
      get: () => okAsync(DEFAULT_PROFILE),
      update: () =>
        okAsync({
          likes: ['ramen'],
          dislikes: [],
          allergies: [],
          constraints: [],
          dailyTargets: { energy_kcal: 2000 },
          goalWeightKg: 62.45,
        }),
    })

    const res = await app.request(patchRequest({ likes: ['ramen'] }))

    expect(await res.json()).toEqual({
      likes: ['ramen'],
      dislikes: [],
      allergies: [],
      constraints: [],
      dailyTargets: { energy_kcal: 2000 },
      goalWeightKg: 62.45,
    })
  })

  it('returns 400 when the body is not valid JSON', async () => {
    const app = buildApp({
      get: () => okAsync(DEFAULT_PROFILE),
      update: noopUpdate,
    })

    const res = await app.request('/api/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'request body must be valid JSON',
    })
  })

  it('returns 400 when a field fails schema validation', async () => {
    const app = buildApp({
      get: () => okAsync(DEFAULT_PROFILE),
      update: noopUpdate,
    })

    const res = await app.request(patchRequest({ likes: 'not-an-array' }))

    // The exact wording is zod's own error message, not this route's
    // contract — only the status code and the shape (a string `error`
    // field) are pinned here.
    expect(res.status).toBe(400)
    expect(errorResponseSchema.safeParse(await res.json()).success).toBe(true)
  })

  it('returns 500 when the update fails', async () => {
    const app = buildApp({
      get: () => okAsync(DEFAULT_PROFILE),
      update: () => errAsync(new UserProfileRepositoryError('boom')),
    })

    const res = await app.request(patchRequest({ likes: ['ramen'] }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})
