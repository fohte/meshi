import type { FilePart, Message, Part } from '@a2a-js/sdk'

import type { AgentContentBlock } from '@/llm/agent/content-block'

export type { AgentContentBlock } from '@/llm/agent/content-block'

// mimeType is optional on FileWithBytes per the A2A spec; default to the
// common case so a caller that omits it still gets a usable content block.
const DEFAULT_IMAGE_MIME_TYPE = 'image/jpeg'

const isFileWithBytes = (
  file: FilePart['file'],
): file is Extract<FilePart['file'], { bytes: string }> => 'bytes' in file

const toContentBlock = (part: Part): AgentContentBlock | undefined => {
  if (part.kind === 'text') {
    return { type: 'text', text: part.text }
  }
  if (part.kind === 'file' && isFileWithBytes(part.file)) {
    return {
      type: 'image',
      mimeType: part.file.mimeType ?? DEFAULT_IMAGE_MIME_TYPE,
      data: part.file.bytes,
    }
  }
  // File-by-URI and data parts aren't part of the shapes this executor's
  // callers send and are dropped rather than guessed at.
  return undefined
}

export const toAgentContent = (message: Message): AgentContentBlock[] =>
  message.parts
    .map(toContentBlock)
    .filter((block): block is AgentContentBlock => block !== undefined)
