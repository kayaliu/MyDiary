import { defineConfig } from 'vite'

// Vite 8 ships with built-in oxc transform — no React plugin needed.
// @vitejs/plugin-react (babel) causes "jsx invalid key" warnings with rolldown.
export default defineConfig({
  // ── Vite 8 built-in React JSX via oxc ─────────────────────────────────
  oxc: {
    transform: {
      react: {
        runtime: 'automatic', // uses React 17+ automatic JSX transform
      },
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
