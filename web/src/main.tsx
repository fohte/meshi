import '#styles/tokens.css'
import '#styles/global.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import { App } from '#App'

// Safari doesn't support Temporal natively yet (https://caniuse.com/temporal);
// browsers that already do skip fetching the polyfill chunk entirely.
if (!('Temporal' in globalThis)) {
  await import('temporal-polyfill/global')
}

const queryClient = new QueryClient()

const rootElement = document.getElementById('root')
if (rootElement === null) {
  // eslint-disable-next-line no-restricted-syntax -- entry-point bootstrap; index.html always defines #root, so this can only fire from a broken build artifact
  throw new Error('#root element not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
