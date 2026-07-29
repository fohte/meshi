import type { Hono } from 'hono'

import { jsonServerError } from '#api/errors'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'

export const mountProfileRoutes = (
  app: Hono,
  userProfileService: UserProfileService,
): void => {
  app.get('/api/profile', async (c) => {
    const result = await userProfileService.get()
    return result.match(
      (profile) =>
        c.json({
          likes: profile.likes,
          dislikes: profile.dislikes,
          allergies: profile.allergies,
          constraints: profile.constraints,
          dailyTargets: profile.dailyTargets ?? null,
        }),
      (repositoryError) => jsonServerError(c, repositoryError),
    )
  })
}
