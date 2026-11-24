import { z } from 'zod'

export const measuredAtSchema = z.union([
  z.iso.datetime({ offset: true }),
  z.iso.datetime({ offset: true, precision: -1 }),
])
