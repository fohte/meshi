// Some reasoning models (e.g. MiniMax's OpenAI-compatible endpoint) emit
// their chain-of-thought inline in the response content wrapped in <think>
// tags. This strips it out so reasoning never reaches the user.
// https://platform.minimax.io/docs/api-reference/text-openai-api
const THINK_BLOCK_PATTERN = /<think>[\s\S]*?<\/think>/gi

// A reasoning model's output can be cut off by a token limit while still
// inside a <think> block, leaving no closing tag; without this, that raw
// reasoning would fall through the pattern above unstripped.
const UNCLOSED_THINK_BLOCK_PATTERN = /<think>[\s\S]*$/i

export interface StripThinkBlocksResult {
  readonly text: string
  // True when a <think> block was actually found and removed.
  readonly stripped: boolean
}

export const stripThinkBlocks = (text: string): StripThinkBlocksResult => {
  const withoutThinkBlocks = text
    .replace(THINK_BLOCK_PATTERN, '')
    .replace(UNCLOSED_THINK_BLOCK_PATTERN, '')
  return {
    text: withoutThinkBlocks.trim(),
    stripped: withoutThinkBlocks !== text,
  }
}
