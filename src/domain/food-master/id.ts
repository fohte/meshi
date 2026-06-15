import { randomBytes } from 'node:crypto'

export type IdGenerator = (prefix: string) => string

export const defaultIdGenerator: IdGenerator = (prefix) =>
  `${prefix}_${randomBytes(12).toString('base64url')}`
