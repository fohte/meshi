import { z } from 'zod'

// The .meta() title pins the name of the synthetic structured-output tool
// that langchain's toolStrategy() generates from this schema. Without a
// title, toolStrategy falls back to an unpredictable global counter
// (`extract-{n}`, see langchain-ai/langchainjs#9693), which would make the
// tool name drift across process restarts and break tests that assert on it.
export const meshiAgentResponseSchema = z
  .object({
    status: z.enum(['input_required', 'completed', 'error']),
    message: z.string(),
  })
  .meta({
    title: 'meshi_agent_response',
    description:
      "The agent's final structured reply to the user for this turn.",
  })

export type MeshiAgentResponse = z.infer<typeof meshiAgentResponseSchema>
