import { z } from 'zod'

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

const inputSchema = z.object({}).strict()

export const createGetUserProfileTool = (
  service: UserProfileService,
): DomainTool => ({
  name: 'get_user_profile',
  description:
    'Return the current single-user profile (likes, dislikes, allergies, constraints, optional daily nutrition targets).',
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<UserProfilePayload, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (!parsed.ok) return parsed
    try {
      return ok(toUserProfilePayload(await service.get()))
    } catch (e) {
      return internalErr(e)
    }
  },
})
