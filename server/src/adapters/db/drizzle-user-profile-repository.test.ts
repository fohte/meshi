import { expect, it } from 'vitest'

import { createDrizzleUserProfileRepository } from '#adapters/db/drizzle-user-profile-repository'
import { DEFAULT_USER_PROFILE } from '#domain/user-profile/user-profile'
import { describeIfDb, setupDrizzleTx } from '#test/db'

const captureOutput = <Output>(output: Output): Output => output

describeIfDb('createDrizzleUserProfileRepository', () => {
  const getTx = setupDrizzleTx()

  it('saves and loads a goal weight', async () => {
    const repository = createDrizzleUserProfileRepository(getTx())
    const saved = await repository.save({
      ...DEFAULT_USER_PROFILE,
      goalWeightKg: 62.45,
    })
    const loaded = await repository.load()

    expect(
      captureOutput(
        saved.match(
          (profile) => ({ status: 'ok', profile }),
          (error) => ({ status: 'error', message: error.message }),
        ),
      ),
    ).toEqual({
      status: 'ok',
      profile: { ...DEFAULT_USER_PROFILE, goalWeightKg: 62.45 },
    })
    expect(
      captureOutput(
        loaded.match(
          (profile) => ({ status: 'ok', profile }),
          (error) => ({ status: 'error', message: error.message }),
        ),
      ),
    ).toEqual({
      status: 'ok',
      profile: { ...DEFAULT_USER_PROFILE, goalWeightKg: 62.45 },
    })
  })

  it('clears a stored goal weight', async () => {
    const repository = createDrizzleUserProfileRepository(getTx())
    await repository.save({ ...DEFAULT_USER_PROFILE, goalWeightKg: 62.45 })

    const cleared = await repository.save(DEFAULT_USER_PROFILE, {
      goalWeightKg: null,
    })
    const loaded = await repository.load()

    expect(
      captureOutput({
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
      cleared: { status: 'ok', profile: DEFAULT_USER_PROFILE },
      loaded: { status: 'ok', profile: DEFAULT_USER_PROFILE },
    })
  })

  it('keeps the current goal weight when a stale partial profile is saved', async () => {
    const repository = createDrizzleUserProfileRepository(getTx())
    const staleProfile = { ...DEFAULT_USER_PROFILE, goalWeightKg: 70 }
    await repository.save(staleProfile)
    await repository.save(
      { ...DEFAULT_USER_PROFILE, goalWeightKg: 65 },
      {
        goalWeightKg: 65,
      },
    )

    const updatedLikes = await repository.save(
      { ...staleProfile, likes: ['fruit'] },
      { likes: ['fruit'] },
    )

    expect(
      captureOutput(
        updatedLikes.match(
          (profile) => ({ status: 'ok', profile }),
          (error) => ({ status: 'error', message: error.message }),
        ),
      ),
    ).toEqual({
      status: 'ok',
      profile: {
        ...DEFAULT_USER_PROFILE,
        likes: ['fruit'],
        goalWeightKg: 65,
      },
    })
  })

  it('rejects an invalid goal weight stored outside the profile API', async () => {
    const tx = getTx()
    const repository = createDrizzleUserProfileRepository(tx)
    await tx`INSERT INTO user_profiles (goal_weight_kg) VALUES ('301.00')`

    const loaded = await repository.load()

    expect(
      captureOutput(
        loaded.match(
          (profile) => ({ status: 'ok', profile }),
          (error) => ({
            status: 'error',
            name: error.name,
            message: error.message,
          }),
        ),
      ),
    ).toEqual({
      status: 'error',
      name: 'UserProfileRowInvalidError',
      message: 'user_profiles.goal_weight_kg is not a valid body weight',
    })
  })
})
