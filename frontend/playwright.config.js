import { defineConfig } from '@playwright/test'
import process from 'node:process'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4199',
    viewport: { width: 1440, height: 900 },
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node ../backend/index.js',
      env: { PORT: '4198', CLIENT_ORIGIN: 'http://127.0.0.1:4199' },
      url: 'http://127.0.0.1:4198/health',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4199 --strictPort',
      env: { VITE_API_URL: 'http://127.0.0.1:4198' },
      url: 'http://127.0.0.1:4199',
      reuseExistingServer: false,
    },
  ],
})
