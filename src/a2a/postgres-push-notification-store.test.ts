import { captureWithFingerprint } from '@fohte/service-kit/observability'
import { describe, expect, it, test, vi } from 'vitest'

import {
  createPostgresPushNotificationStore,
  PushConfigRowInvalidError,
  PushNotificationStorePersistenceError,
} from '@/a2a/postgres-push-notification-store'
import type { Sql } from '@/db'
import { captureSqlParams, describeIfDb, setupTx } from '@/test/db'

vi.mock('@fohte/service-kit/observability', () => ({
  captureWithFingerprint: vi.fn(),
}))

describeIfDb('createPostgresPushNotificationStore', () => {
  const getTx = setupTx()

  it('round-trips a saved config, defaulting the id to the task id', async () => {
    const store = createPostgresPushNotificationStore(getTx())

    await store.save('task-1', {
      url: 'https://example.com/push',
      token: 'secret-token',
    })

    expect(await store.load('task-1')).toEqual([
      { id: 'task-1', url: 'https://example.com/push', token: 'secret-token' },
    ])
  })

  it('keeps a caller-supplied id as-is', async () => {
    const store = createPostgresPushNotificationStore(getTx())

    await store.save('task-1', {
      id: 'custom-config-id',
      url: 'https://example.com/push',
    })

    expect(await store.load('task-1')).toEqual([
      { id: 'custom-config-id', url: 'https://example.com/push' },
    ])
  })

  it('returns an empty array for a task with no configs', async () => {
    const store = createPostgresPushNotificationStore(getTx())
    expect(await store.load('no-such-task')).toEqual([])
  })

  it('supports multiple configs per task', async () => {
    const store = createPostgresPushNotificationStore(getTx())

    await store.save('task-multi', {
      id: 'config-a',
      url: 'https://example.com/a',
    })
    await store.save('task-multi', {
      id: 'config-b',
      url: 'https://example.com/b',
    })

    const loaded = await store.load('task-multi')
    const byId = (config: { id?: string }): string => config.id ?? ''
    expect([...loaded].sort((a, b) => byId(a).localeCompare(byId(b)))).toEqual([
      { id: 'config-a', url: 'https://example.com/a' },
      { id: 'config-b', url: 'https://example.com/b' },
    ])
  })

  it('overwrites the config for the same (task, config) id on a later save', async () => {
    const store = createPostgresPushNotificationStore(getTx())

    await store.save('task-1', {
      id: 'config-a',
      url: 'https://example.com/old',
    })
    await store.save('task-1', {
      id: 'config-a',
      url: 'https://example.com/new',
    })

    expect(await store.load('task-1')).toEqual([
      { id: 'config-a', url: 'https://example.com/new' },
    ])
  })

  it('deletes a config by explicit configId', async () => {
    const store = createPostgresPushNotificationStore(getTx())
    await store.save('task-1', { id: 'config-a', url: 'https://example.com/a' })
    await store.save('task-1', { id: 'config-b', url: 'https://example.com/b' })

    await store.delete('task-1', 'config-a')

    expect(await store.load('task-1')).toEqual([
      { id: 'config-b', url: 'https://example.com/b' },
    ])
  })

  it('deletes only the default (taskId-keyed) config when configId is omitted', async () => {
    const store = createPostgresPushNotificationStore(getTx())
    // Saved without an id, so it defaults to the task id.
    await store.save('task-1', { url: 'https://example.com/default' })
    await store.save('task-1', { id: 'config-b', url: 'https://example.com/b' })

    await store.delete('task-1')

    expect(await store.load('task-1')).toEqual([
      { id: 'config-b', url: 'https://example.com/b' },
    ])
  })
})

// Like DefaultRequestHandler's handling of TaskStore, the SDK doesn't
// propagate a PushNotificationStore failure to the caller in a way that
// surfaces it anywhere visible: a message/send-path save() failure is
// swallowed inside the SDK into a generic JSON-RPC error, and a
// send()-path load() failure (DefaultPushNotificationSender.send() is
// fire-and-forget) becomes an unhandled rejection. These tests don't need a
// real database: they pin that a failure reaching `sql` (or an invalid
// config row) is wrapped, reported to Sentry, and rethrown before it can
// disappear into either of those.
describe('error reporting', () => {
  // Minimal fake of postgres.Sql's tagged-template call, mirroring
  // captureSqlParams in src/test/db.ts.
  const buildFakeSql = (
    outcome: { reject: Error } | { resolve: unknown[] },
  ): Sql => {
    const tag = (first: TemplateStringsArray | readonly string[]): unknown => {
      if (!('raw' in first)) return first
      return 'reject' in outcome
        ? Promise.reject(outcome.reject)
        : Promise.resolve(outcome.resolve)
    }
    const fakeSql = Object.assign(tag, { typed: (value: unknown) => value })
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal fake of postgres.Sql's tagged-template call; only the surface exercised by the store under test.
    return fakeSql as unknown as Sql
  }

  const rejectedError = async (promise: Promise<unknown>): Promise<unknown> =>
    promise.then(
      () => {
        throw new Error('expected the promise to reject')
      },
      (err: unknown) => err,
    )

  const runSaveFailure = async (dbError: Error): Promise<unknown> => {
    const store = createPostgresPushNotificationStore(
      buildFakeSql({ reject: dbError }),
    )
    return rejectedError(
      store.save('task-save-fail', { url: 'https://example.com/push' }),
    )
  }

  it('wraps and rethrows a save failure as PushNotificationStorePersistenceError', async () => {
    const dbError = new Error('connection terminated')
    const thrown = await runSaveFailure(dbError)
    if (!(thrown instanceof PushNotificationStorePersistenceError)) {
      throw new Error(
        'expected save() to throw a PushNotificationStorePersistenceError',
      )
    }

    expect(thrown.message).toBe(
      'failed to save push_config for task task-save-fail',
    )
    expect(thrown.cause).toBe(dbError)
  })

  it('reports a save failure to Sentry', async () => {
    const dbError = new Error('connection terminated')
    const thrown = await runSaveFailure(dbError)

    expect(vi.mocked(captureWithFingerprint).mock.calls).toEqual([
      [
        thrown,
        'a2a.push-notification-store.persistence-error',
        {
          extras: {
            taskId: 'task-save-fail',
            configId: 'task-save-fail',
            method: 'save',
          },
        },
      ],
    ])
  })

  const runLoadFailure = async (dbError: Error): Promise<unknown> => {
    const store = createPostgresPushNotificationStore(
      buildFakeSql({ reject: dbError }),
    )
    return rejectedError(store.load('task-load-fail'))
  }

  it('wraps and rethrows a load failure as PushNotificationStorePersistenceError', async () => {
    const dbError = new Error('connection terminated')
    const thrown = await runLoadFailure(dbError)
    if (!(thrown instanceof PushNotificationStorePersistenceError)) {
      throw new Error(
        'expected load() to throw a PushNotificationStorePersistenceError',
      )
    }

    expect(thrown.message).toBe(
      'failed to load push_configs for task task-load-fail',
    )
    expect(thrown.cause).toBe(dbError)
  })

  it('reports a load failure to Sentry', async () => {
    const dbError = new Error('connection terminated')
    const thrown = await runLoadFailure(dbError)

    expect(vi.mocked(captureWithFingerprint).mock.calls).toEqual([
      [
        thrown,
        'a2a.push-notification-store.persistence-error',
        { extras: { taskId: 'task-load-fail', method: 'load' } },
      ],
    ])
  })

  const runInvalidRowLoadFailure = async (): Promise<unknown> => {
    const store = createPostgresPushNotificationStore(
      buildFakeSql({ resolve: [{ config: { id: 'cfg', url: 42 } }] }),
    )
    return rejectedError(store.load('task-bad-row'))
  }

  it('wraps and rethrows an invalid config row as PushNotificationStorePersistenceError', async () => {
    const thrown = await runInvalidRowLoadFailure()
    if (!(thrown instanceof PushNotificationStorePersistenceError)) {
      throw new Error(
        'expected load() to throw a PushNotificationStorePersistenceError',
      )
    }

    expect(thrown.message).toBe(
      'failed to load push_configs for task task-bad-row',
    )
    expect(thrown.cause).toBeInstanceOf(PushConfigRowInvalidError)
  })

  it('reports an invalid config row load failure to Sentry', async () => {
    const thrown = await runInvalidRowLoadFailure()

    expect(vi.mocked(captureWithFingerprint).mock.calls).toEqual([
      [
        thrown,
        'a2a.push-notification-store.persistence-error',
        { extras: { taskId: 'task-bad-row', method: 'load' } },
      ],
    ])
  })

  const runDeleteFailure = async (dbError: Error): Promise<unknown> => {
    const store = createPostgresPushNotificationStore(
      buildFakeSql({ reject: dbError }),
    )
    return rejectedError(store.delete('task-delete-fail', 'config-a'))
  }

  it('wraps and rethrows a delete failure as PushNotificationStorePersistenceError', async () => {
    const dbError = new Error('connection terminated')
    const thrown = await runDeleteFailure(dbError)
    if (!(thrown instanceof PushNotificationStorePersistenceError)) {
      throw new Error(
        'expected delete() to throw a PushNotificationStorePersistenceError',
      )
    }

    expect(thrown.message).toBe(
      'failed to delete push_config for task task-delete-fail',
    )
    expect(thrown.cause).toBe(dbError)
  })

  it('reports a delete failure to Sentry', async () => {
    const dbError = new Error('connection terminated')
    const thrown = await runDeleteFailure(dbError)

    expect(vi.mocked(captureWithFingerprint).mock.calls).toEqual([
      [
        thrown,
        'a2a.push-notification-store.persistence-error',
        {
          extras: {
            taskId: 'task-delete-fail',
            configId: 'config-a',
            method: 'delete',
          },
        },
      ],
    ])
  })
})

// Production wiring shares this store's connection pool with drizzle()-
// backed repositories (see the comment in postgres-task-store.ts and the
// file header here), which corrupts postgres.js's serialization of any raw
// plain-object parameter interpolated into a `sql` template afterward.
// This test doesn't need a real database — it asserts on what
// createPostgresPushNotificationStore hands to its `sql` dependency (a
// pre-serialized string, not the raw config object).
describe('parameters passed to sql', () => {
  test('save() passes config as a pre-serialized string', async () => {
    const { sql, params } = captureSqlParams()
    const store = createPostgresPushNotificationStore(sql)

    await store.save('task-param-check', {
      id: 'config-param-check',
      url: 'https://example.com/push',
    })

    expect(params).toEqual([
      'task-param-check',
      'config-param-check',
      JSON.stringify({
        id: 'config-param-check',
        url: 'https://example.com/push',
      }),
    ])
  })
})
