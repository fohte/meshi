import '#index.css'
import '#styles/tokens.css'
import '#styles/global.css'

import { withThemeByClassName } from '@storybook/addon-themes'
import type { Preview } from '@storybook/react-vite'

const preview: Preview = {
  decorators: [
    withThemeByClassName({
      themes: {
        light: '',
        dark: 'dark',
      },
      defaultTheme: 'light',
    }),
  ],
}

export default preview
