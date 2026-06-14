import { describe, expect, it } from 'vitest'

import type {
  ImageDownsampler,
  McpImageContent,
  SupportedImageMimeType,
} from '@/adapters/image/image-interpreter'
import {
  DEFAULT_MAX_IMAGE_BYTES,
  interpretImage,
  SUPPORTED_IMAGE_MIME_TYPES,
} from '@/adapters/image/image-interpreter'

const base64OfDecodedBytes = (bytes: number): string =>
  Buffer.alloc(bytes).toString('base64')

const SAMPLE_BASE64 = base64OfDecodedBytes(3)

const sampleImage = (mimeType: SupportedImageMimeType): McpImageContent => ({
  mimeType,
  base64: SAMPLE_BASE64,
})

describe('interpretImage', () => {
  it.each(SUPPORTED_IMAGE_MIME_TYPES)(
    'passes through mimeType %s as a vision image block',
    async (mimeType) => {
      expect(await interpretImage({ image: sampleImage(mimeType) })).toEqual([
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: SAMPLE_BASE64 },
        },
      ])
    },
  )

  it('places hintText before the image in the content array', async () => {
    expect(
      await interpretImage({
        image: sampleImage('image/png'),
        hintText: 'これは朝食です',
      }),
    ).toEqual([
      { type: 'text', text: 'これは朝食です' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: SAMPLE_BASE64,
        },
      },
    ])
  })

  it('omits the text block when hintText is an empty string', async () => {
    expect(
      await interpretImage({
        image: sampleImage('image/jpeg'),
        hintText: '',
      }),
    ).toEqual([
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: SAMPLE_BASE64,
        },
      },
    ])
  })

  it('passes through at exactly 10 MB without invoking the downsampler', async () => {
    const base64 = base64OfDecodedBytes(DEFAULT_MAX_IMAGE_BYTES)
    const calls: McpImageContent[] = []
    const downsample: ImageDownsampler = (image) => {
      calls.push(image)
      return image
    }

    const result = await interpretImage(
      { image: { mimeType: 'image/jpeg', base64 } },
      { downsample },
    )

    expect({ result, downsampleCalls: calls.length }).toEqual({
      result: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
        },
      ],
      downsampleCalls: 0,
    })
  })

  it('invokes the downsampler when the decoded image exceeds 10 MB', async () => {
    const oversizedBase64 = base64OfDecodedBytes(DEFAULT_MAX_IMAGE_BYTES + 1)
    const downsampledBase64 = base64OfDecodedBytes(1024)
    const downsample: ImageDownsampler = () => ({
      mimeType: 'image/jpeg',
      base64: downsampledBase64,
    })

    const result = await interpretImage(
      { image: { mimeType: 'image/jpeg', base64: oversizedBase64 } },
      { downsample },
    )

    expect(result).toEqual([
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: downsampledBase64,
        },
      },
    ])
  })

  it('passes the oversized image through when no downsampler is configured', async () => {
    const oversizedBase64 = base64OfDecodedBytes(DEFAULT_MAX_IMAGE_BYTES + 1)

    expect(
      await interpretImage({
        image: { mimeType: 'image/png', base64: oversizedBase64 },
      }),
    ).toEqual([
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: oversizedBase64,
        },
      },
    ])
  })

  it('honors a custom maxBytes threshold', async () => {
    const base64 = base64OfDecodedBytes(2048)
    const downsample: ImageDownsampler = () => ({
      mimeType: 'image/webp',
      base64: 'DOWN',
    })

    const result = await interpretImage(
      { image: { mimeType: 'image/webp', base64 } },
      { maxBytes: 1024, downsample },
    )

    expect(result).toEqual([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/webp', data: 'DOWN' },
      },
    ])
  })
})
