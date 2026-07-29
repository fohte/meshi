export interface NavItem {
  label: string
  path: string
}

// Order matches the prototype's sidebar / tab bar (今日 / 履歴 / 食品 / 設定).
export const NAV_ITEMS: readonly NavItem[] = [
  { label: '今日', path: '/' },
  { label: '履歴', path: '/history' },
  { label: '食品', path: '/foods' },
  { label: '設定', path: '/settings' },
]
