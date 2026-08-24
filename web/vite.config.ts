import react from '@vitejs/plugin-react'
// defineConfig comes from vitest/config, not vite: it is the Vitest-aware
// variant that knows about the `test` key. Importing it from 'vite' type-checks
// fine under `vitest run` but fails `tsc -b` during a production build.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // Set for GitHub Pages project-site hosting; override with VITE_BASE=/ for
  // root deploys (Vercel, Netlify) or local preview.
  base: process.env.VITE_BASE ?? '/ledger-reconciler/',
  test: {
    environment: 'node', // domain layer is pure TS, no DOM needed
    include: ['tests/**/*.test.ts'],
  },
})
