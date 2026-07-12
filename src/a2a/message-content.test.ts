import type { Message } from '@a2a-js/sdk'
import { describe, expect, it } from 'vitest'

import { toAgentContent } from '@/a2a/message-content'

const buildMessage = (parts: Message['parts']): Message => ({
  kind: 'message',
  messageId: 'msg-1',
  role: 'user',
  parts,
})

describe('toAgentContent', () => {
  it('converts a text part to a text content block', () => {
    const message = buildMessage([{ kind: 'text', text: 'hello' }])

    expect(toAgentContent(message)).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('converts a base64 file part to an image content block', () => {
    const message = buildMessage([
      { kind: 'file', file: { bytes: 'base64data', mimeType: 'image/png' } },
    ])

    expect(toAgentContent(message)).toEqual([
      { type: 'image', mimeType: 'image/png', data: 'base64data' },
    ])
  })

  it('defaults the mime type when a file part omits it', () => {
    const message = buildMessage([
      { kind: 'file', file: { bytes: 'base64data' } },
    ])

    expect(toAgentContent(message)).toEqual([
      { type: 'image', mimeType: 'image/jpeg', data: 'base64data' },
    ])
  })

  it('drops a file part addressed by URI', () => {
    const message = buildMessage([
      { kind: 'file', file: { uri: 'https://example.com/a.png' } },
    ])

    expect(toAgentContent(message)).toEqual([])
  })

  it('preserves the order of mixed text and image parts', () => {
    const message = buildMessage([
      { kind: 'text', text: 'what is this?' },
      { kind: 'file', file: { bytes: 'imgdata', mimeType: 'image/webp' } },
    ])

    expect(toAgentContent(message)).toEqual([
      { type: 'text', text: 'what is this?' },
      { type: 'image', mimeType: 'image/webp', data: 'imgdata' },
    ])
  })
})
