import { z } from 'zod'

import type { UserProfilePatch } from '@/domain/user-profile/user-profile'
import type { UserProfileService } from '@/domain/user-profile/user-profile-service'
import { internalErr } from '@/llm/domain-tools/internal-error'
import { parseToolInput } from '@/llm/domain-tools/parse'
import {
  toUserProfilePayload,
  type UserProfilePayload,
} from '@/llm/domain-tools/tools/user-profile-payload'
import {
  type DomainTool,
  ok,
  type Result,
  type ToolError,
} from '@/llm/domain-tools/types'

const inputSchema = z.object({
  likes: z.array(z.string().min(1)).optional(),
  dislikes: z.array(z.string().min(1)).optional(),
  allergies: z.array(z.string().min(1)).optional(),
  constraints: z.array(z.string().min(1)).optional(),
  daily_targets: z.record(z.string(), z.number()).optional(),
})

export const createUpdateUserProfileTool = (
  service: UserProfileService,
): DomainTool => ({
  name: 'update_user_profile',
  description:
    'Patch fields on the single-user profile. Omitted fields are left unchanged; arrays are replaced wholesale; daily_targets is merged shallowly.',
  inputSchema: z.toJSONSchema(inputSchema),
  async execute(
    input: unknown,
  ): Promise<Result<UserProfilePayload, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (!parsed.ok) return parsed
    try {
      const patch: UserProfilePatch = {
        ...(parsed.value.likes === undefined
          ? {}
          : { likes: parsed.value.likes }),
        ...(parsed.value.dislikes === undefined
          ? {}
          : { dislikes: parsed.value.dislikes }),
        ...(parsed.value.allergies === undefined
          ? {}
          : { allergies: parsed.value.allergies }),
        ...(parsed.value.constraints === undefined
          ? {}
          : { constraints: parsed.value.constraints }),
        ...(parsed.value.daily_targets === undefined
          ? {}
          : { dailyTargets: parsed.value.daily_targets }),
      }

      return ok(toUserProfilePayload(await service.update(patch)))
    } catch (e) {
      return internalErr(e)
    }
  },
})
