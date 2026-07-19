import * as Sentry from '@sentry/node'

export const reportError = (message: string, err: unknown): void => {
  console.error(message, err)
  Sentry.captureException(err)
}
