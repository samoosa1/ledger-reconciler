import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

/*
 * Fonts are self-hosted, not linked from Google Fonts, and that is a
 * product decision rather than a preference. The page tells the visitor
 * their files never leave the browser and that it still works with the
 * network off. A stylesheet fetched from fonts.googleapis.com would make
 * that claim visibly false the moment anyone tested it.
 *
 * Only the upright weights are imported. Each @font-face carries a
 * unicode-range, so a browser downloads the latin subset and skips the
 * rest; the extra subsets cost disk in the build, not transfer.
 */
import '@fontsource-variable/archivo/wght.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'

import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
