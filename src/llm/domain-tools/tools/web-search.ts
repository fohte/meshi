import { z } from 'zod'

import {
  type WebSearchClient,
  WebSearchRateLimitError,
} from '#adapters/web-search/web-search-client'
import { parseToolInput } from '#llm/domain-tools/parse'
import {
  type DomainTool,
  err,
  type Result,
  type ToolError,
} from '#llm/domain-tools/types'

const inputSchema = z.object({
  // Validated but not read in execute() below: forces one call per food
  // item without folding several into one query. Unlike
  // search-food-master.ts's user_input_item, it isn't echoed in the
  // output — one web_search call already produces one snippet set tied to
  // its own tool_use_id, so there's no merged result to disambiguate.
  user_input_item: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().positive().max(20).optional().default(5),
})

export interface WebSearchOutput {
  readonly snippets: ReadonlyArray<{
    readonly title: string
    readonly url: string
    readonly text: string
  }>
}

export const createWebSearchTool = (client: WebSearchClient): DomainTool => ({
  name: 'web_search',
  description:
    'Search the web for short snippets useful to a nutrition lookup for a single food item — never fold multiple distinct items into one query; search each item with its own call. user_input_item must be exactly what the user said for that one item. Returns title/url/text snippets only; the caller must follow-up to obtain authoritative nutrition values.',
  // io: 'input' — see the comment in search-food-master.ts; `limit`'s
  // `.default(5)` would otherwise be marked `required` in the generated
  // schema, rejecting a caller that omits it.
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(input: unknown): Promise<Result<WebSearchOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)
    return await client
      .search(parsed.value.query, { limit: parsed.value.limit })
      .map((result) => ({ snippets: result.snippets }))
      .mapErr((e): ToolError =>
        e instanceof WebSearchRateLimitError
          ? { code: 'web_search/rate_limited', message: e.message }
          : {
              code: 'web_search/failed',
              message: e.message,
              ...(e.status === undefined
                ? {}
                : { details: { status: e.status } }),
            },
      )
  },
})
