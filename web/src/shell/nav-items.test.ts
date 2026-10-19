import { describe, expect, it } from 'vitest'

import { NAV_ITEMS } from '#shell/nav-items'

describe('NAV_ITEMS', () => {
  it('places stock between meal sets and foods', () => {
    expect(NAV_ITEMS).toEqual([
      { label: '今日', path: '/' },
      { label: '履歴', path: '/history' },
      { label: 'マイセット', path: '/meal-sets' },
      { label: '在庫', path: '/stock' },
      { label: '食品', path: '/foods' },
      { label: '設定', path: '/settings' },
    ])
  })
})
