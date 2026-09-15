import '#bootstrap'

<<<<<<< before updating
import * as Sentry from '@sentry/node'
||||||| last update
export const greet = (name: string): string => {
  return `Hello, ${name}!`
}
=======
import { err, ok, type Result } from 'neverthrow'
>>>>>>> after updating

<<<<<<< before updating
import { EnvError } from '#env'
import { main } from '#main'

main().catch(async (err: unknown) => {
  if (err instanceof EnvError) {
    for (const issue of err.issues) console.error(issue)
  } else {
    console.error(err)
  }
  Sentry.captureException(err)
  // main() can reject before anything else flushes Sentry (e.g. missing
  // env), so this exit path has to flush it directly. Imported dynamically
  // (rather than a named import above) so the bootstrap side-effect import
  // stays a bare, unsorted first import — required for OTel patching order.
  const { observability } = await import('#bootstrap')
  await observability?.shutdown()
  process.exit(1)
})
||||||| last update
export const greet = (name: string): string => {
  return `Hello, ${name}!`
}
=======
export const greet = (name: string): Result<string, Error> => {
  if (!name) return err(new Error('name must not be empty'))
  return ok(`Hello, ${name}!`)
}
>>>>>>> after updating
