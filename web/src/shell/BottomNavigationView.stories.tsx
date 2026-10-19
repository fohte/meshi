import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router'

import { BottomNavigationView } from '#shell/BottomNavigationView'
import type { NavItem } from '#shell/nav-items'

const DESTINATIONS: ReadonlyArray<NavItem> = [
  { label: '星のしるべ', path: '/sample/stars' },
  { label: '月食記', path: '/sample/moon' },
  { label: '雲海図', path: '/sample/clouds' },
  { label: '森影図', path: '/sample/forest' },
  { label: '潮騒記', path: '/sample/ocean' },
  { label: '夜空', path: '/sample/sky' },
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
