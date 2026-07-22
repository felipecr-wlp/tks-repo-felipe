import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Config de Vitest para pruebas unitarias y de handlers de API.
 * Entorno node (no jsdom): estas pruebas ejercen logica de servidor.
 * Alias @/ -> src/ replicado manualmente (no hay vite-tsconfig-paths instalado).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
})
