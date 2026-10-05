export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number]
