import { expect, it } from 'vitest'

import { createDrizzleUserProfileRepository } from '#adapters/db/drizzle-user-profile-repository'
import { DEFAULT_USER_PROFILE } from '#domain/user-profile/user-profile'
import { describeIfDb, setupDrizzleTx } from '#test/db'

const captureOutput = <Output>(output: Output): Output => output

describeIfDb('createDrizzleUserProfileRepository', () => {
  const getTx = setupDrizzleTx()

  it('round-trips and clears a goal weight', async () => {
    const repository = createDrizzleUserProfileRepository(getTx())
    const saved = await repository.save({
      ...DEFAULT_USER_PROFILE,
      goalWeightKg: 62.45,
    })
    const cleared = await repository.save(DEFAULT_USER_PROFILE)
    const loaded = await repository.load()

    expect(
      captureOutput({
        saved: saved.match(
          (profile) => ({ status: 'ok', profile }),
          (error) => ({ status: 'error', message: error.message }),
        ),
        cleared: cleared.match(
          (profile) => ({ status: 'ok', profile }),
          (error) => ({ status: 'error', message: error.message }),
        ),
        loaded: loaded.match(
          (profile) => ({ status: 'ok', profile }),
          (error) => ({ status: 'error', message: error.message }),
        ),
      }),
    ).toEqual({
      saved: {
        status: 'ok',
        profile: { ...DEFAULT_USER_PROFILE, goalWeightKg: 62.45 },
      },
      cleared: { status: 'ok', profile: DEFAULT_USER_PROFILE },
      loaded: {
        status: 'ok',
        profile: DEFAULT_USER_PROFILE,
      },
    })
  })
})
