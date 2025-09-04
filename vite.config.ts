import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/commands',
      '@codemirror/search',
      '@lezer/common',
      '@lezer/highlight',
      '@lezer/lr',
    ],
  },
  optimizeDeps: {
    include: [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/commands',
      '@codemirror/search',
      // Intentionally omit '@codemirror/gutter' and '@codemirror/highlight'
      // since gutter is legacy (0.19.x) and highlight may not be installed.
    ],
  },
})
