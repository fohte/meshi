import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router'

import { BottomNavigationView } from '#shell/BottomNavigationView'
import type { NavItem } from '#shell/nav-items'

const DESTINATIONS: ReadonlyArray<NavItem> = [
  { label: '星のしるべ', path: '/sample/stars' },
  { label: '月の観測', path: '/sample/moon' },
  { label: '雲の記録', path: '/sample/clouds' },
  { label: '森の地図', path: '/sample/forest' },
  { label: '海の音色', path: '/sample/ocean' },
  { label: '空の便り', path: '/sample/sky' },
]

const SELECTED_PATH = '/sample/stars/catalog'

const meta: Meta<typeof BottomNavigationView> = {
  title: 'shell/BottomNavigationView',
  component: BottomNavigationView,
  args: {
    'aria-label': 'Sample destinations',
    items: DESTINATIONS.slice(0, 5),
    pathname: SELECTED_PATH,
  },
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={[SELECTED_PATH]}>
        <div style={{ width: '320px' }}>
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof BottomNavigationView>

export const FiveItems: Story = {
  name: 'Five fictional destinations fit in one row at 320 px.',
}

export const SixItems: Story = {
  name: 'Six fictional destinations fit in one row at 320 px.',
  args: { items: DESTINATIONS },
}
