import '#index.css'
import '#styles/tokens.css'
import '#styles/global.css'

import {
  afterEach,
  beforeEach,
  configureUnhandledApiRequestCheck,
  parameters,
  reportUnhandledApiRequest,
} from '@fohte/storybook-addon/preview'
import { withThemeByClassName } from '@storybook/addon-themes'
import type { Preview } from '@storybook/react-vite'
import { setupWorker } from 'msw/browser'
import { mswLoader } from 'msw-storybook-addon/csf3'

configureUnhandledApiRequestCheck({ pathPrefixes: ['/api/'] })

// .storybook/vitest.setup.ts imports this file directly via
// setProjectAnnotations(), bypassing main.ts's `addons` resolution
// entirely — @fohte/storybook-addon isn't listed there (see main.ts), so
// its beforeEach/afterEach checks must be spread here explicitly to run
// under both `storybook dev`/`build` and the Vitest test-runner path.
const preview: Preview = {
  parameters,
  beforeEach,
  afterEach,
  decorators: [
    withThemeByClassName({
      themes: {
        light: '',
        dark: 'dark',
      },
      defaultTheme: 'light',
    }),
  ],
  loaders: [
    mswLoader(async () => {
      const worker = setupWorker()
      await worker.start({
        onUnhandledRequest: (request, print) => {
          if (reportUnhandledApiRequest(request.url)) {
            print.error()
          }
        },
      })
      return worker
    }),
  ],
}

export default preview
