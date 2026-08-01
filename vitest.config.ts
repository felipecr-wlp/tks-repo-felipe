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
      // `server-only` es un centinela de Next que no resuelve fuera de su bundler.
      // Se sustituye por un modulo vacio para poder PROBAR los helpers de servidor
      // que lo importan (ver tests/stubs/server-only.ts). La proteccion real la
      // sigue aplicando el build de Next, no el test.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
})
