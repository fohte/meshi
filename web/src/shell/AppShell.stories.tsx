import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter, Route, Routes } from 'react-router'

import { AppShell } from '#shell/AppShell'

const ExamplePage = (): React.JSX.Element => (
  <section>
    <p
      style={{
        color: 'var(--color-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        margin: '0 0 8px',
      }}
    >
      TODAY
    </p>
    <h1 style={{ fontSize: '22px', margin: '0 0 20px' }}>今日の記録</h1>
    <div
      style={{
        border: 'var(--border-width) solid var(--color-border)',
        padding: '20px',
      }}
    >
      <p style={{ margin: '0 0 8px' }}>記録はまだありません</p>
      <p style={{ color: 'var(--color-muted)', fontSize: '13px', margin: 0 }}>
        食事を記録すると、ここに今日の内容が表示されます。
      </p>
    </div>
  </section>
)

const meta: Meta<typeof AppShell> = {
  title: 'shell/AppShell',
  component: AppShell,
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Story />}>
            <Route index element={<ExamplePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof AppShell>

export const Default: Story = {
  name: 'The app shell shows the today page and navigation.',
}
