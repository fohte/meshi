import type { UseQueryResult } from '@tanstack/react-query'
import { z } from 'zod'

import type { ApiRequestError } from '#api/fetch-json'
import { fetchJson } from '#api/fetch-json'
import { useResultQuery } from '#api/use-result-query'

const profileSchema = z.object({
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  allergies: z.array(z.string()),
  constraints: z.array(z.string()),
  dailyTargets: z.record(z.string(), z.number()).nullable(),
})

export type Profile = z.infer<typeof profileSchema>

export const useProfile = (): UseQueryResult<Profile, ApiRequestError> =>
  useResultQuery(['profile'], () => fetchJson('/api/profile', profileSchema))
