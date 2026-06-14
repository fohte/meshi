export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number]

export interface McpImageContent {
  readonly mimeType: SupportedImageMimeType
  readonly base64: string
}

export interface VisionTextBlock {
  readonly type: 'text'
  readonly text: string
}

export interface VisionImageBlock {
  readonly type: 'image'
  readonly source: {
    readonly type: 'base64'
    readonly media_type: SupportedImageMimeType
    readonly data: string
  }
}

export type VisionContentBlock = VisionTextBlock | VisionImageBlock

export interface InterpretImageInput {
  readonly image: McpImageContent
  readonly hintText?: string
}

export type ImageDownsampler = (
  image: McpImageContent,
) => Promise<McpImageContent> | McpImageContent

export interface ImageInterpreterOptions {
  readonly maxBytes?: number
  readonly downsample?: ImageDownsampler
}

export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024

const decodedBase64ByteLength = (base64: string): number =>
  Buffer.byteLength(base64, 'base64')

export const interpretImage = async (
  input: InterpretImageInput,
  options: ImageInterpreterOptions = {},
): Promise<readonly VisionContentBlock[]> => {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES
  const decodedBytes = decodedBase64ByteLength(input.image.base64)

  const image =
    decodedBytes > maxBytes && options.downsample !== undefined
      ? await options.downsample(input.image)
      : input.image

  const imageBlock: VisionImageBlock = {
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.mimeType,
      data: image.base64,
    },
  }

  if (input.hintText !== undefined && input.hintText !== '') {
    return [{ type: 'text', text: input.hintText }, imageBlock]
  }
  return [imageBlock]
}
