import { Result } from 'neverthrow'

export const parseJson = Result.fromThrowable((text: string): unknown =>
  JSON.parse(text),
)
