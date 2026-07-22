import { defineConfig, devices } from '@playwright/test'

/**
 * Config minima de Playwright para pruebas e2e.
 * No levanta servidor propio (sin webServer): los specs asumen un target
 * externo o se agregaran despues. Un solo proyecto: chromium.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
