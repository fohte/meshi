import type { ResultAsync } from 'neverthrow'

import type { CodedDomainError } from '#domain/errors'

export const captureDomainError = async (
  resultAsync: ResultAsync<unknown, CodedDomainError<string>>,
): Promise<{ code: string; details: Readonly<Record<string, unknown>> }> => {
  const result = await resultAsync
  if (result.isOk()) {
    // eslint-disable-next-line no-restricted-syntax -- test-helper assertion guard; this module doesn't match the built-in test-file glob (*.test.ts/__tests__/**) despite being test infrastructure
    throw new Error('expected a domain error but got Ok')
  }
  return { code: result.error.code, details: result.error.details }
}
