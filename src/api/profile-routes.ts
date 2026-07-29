import type { Hono } from 'hono'
import { ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { jsonBadRequest, jsonServerError } from '#api/errors'
import { NUTRIENT_CODES } from '#db/seed/nutrient-definitions'
import type {
  UserProfile,
  UserProfilePatch,
} from '#domain/user-profile/user-profile'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'

// Mirrors the validation in src/llm/domain-tools/tools/update-user-profile.ts,
// the other UserProfilePatch producer: non-empty tags, and dailyTargets keys
// restricted to known nutrient codes.
const userProfilePatchSchema = z.object({
  likes: z.array(z.string().min(1)).optional(),
  dislikes: z.array(z.string().min(1)).optional(),
  allergies: z.array(z.string().min(1)).optional(),
  constraints: z.array(z.string().min(1)).optional(),
  dailyTargets: z
    .partialRecord(z.enum(NUTRIENT_CODES), z.number())
    .nullable()
    .optional(),
})

const toProfileResponse = (profile: UserProfile) => ({
  likes: profile.likes,
  dislikes: profile.dislikes,
  allergies: profile.allergies,
  constraints: profile.constraints,
  dailyTargets: profile.dailyTargets ?? null,
})

export const mountProfileRoutes = (
  app: Hono,
  userProfileService: UserProfileService,
): void => {
  app.get('/api/profile', async (c) => {
    const result = await userProfileService.get()
    return result.match(
      (profile) => c.json(toProfileResponse(profile)),
      (repositoryError) => jsonServerError(c, repositoryError),
    )
  })

  app.patch('/api/profile', async (c) => {
    const bodyResult = await ResultAsync.fromPromise(
      c.req.json(),
      () => new Error('request body must be valid JSON'),
    )
    if (bodyResult.isErr()) {
      return jsonBadRequest(c, bodyResult.error.message)
    }

    const parsed = userProfilePatchSchema.safeParse(bodyResult.value)
    if (!parsed.success) {
      return jsonBadRequest(
        c,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      )
    }

    // exactOptionalPropertyTypes rejects `{ likes: undefined }`, so omitted
    // fields must be left out of the object entirely rather than set to
    // undefined (see src/llm/domain-tools/tools/update-user-profile.ts).
    const patch: UserProfilePatch = {
      ...(parsed.data.likes === undefined ? {} : { likes: parsed.data.likes }),
      ...(parsed.data.dislikes === undefined
        ? {}
        : { dislikes: parsed.data.dislikes }),
      ...(parsed.data.allergies === undefined
        ? {}
        : { allergies: parsed.data.allergies }),
      ...(parsed.data.constraints === undefined
        ? {}
        : { constraints: parsed.data.constraints }),
      ...(parsed.data.dailyTargets === undefined
        ? {}
        : { dailyTargets: parsed.data.dailyTargets }),
    }

    const result = await userProfileService.update(patch)
    return result.match(
      (profile) => c.json(toProfileResponse(profile)),
      (repositoryError) => jsonServerError(c, repositoryError),
    )
  })
}
