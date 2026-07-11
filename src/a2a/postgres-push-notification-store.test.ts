import { expect, it } from 'vitest'

import { createPostgresPushNotificationStore } from '@/a2a/postgres-push-notification-store'
import { describeIfDb, setupDrizzleTx } from '@/test/db'

describeIfDb('createPostgresPushNotificationStore', () => {
  const getTx = setupDrizzleTx()

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
