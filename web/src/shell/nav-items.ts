export interface NavItem {
  label: string
  path: string
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: '今日', path: '/' },
  { label: '履歴', path: '/history' },
  { label: '食品', path: '/foods' },
  { label: '設定', path: '/settings' },
]
