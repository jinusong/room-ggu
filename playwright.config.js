import { defineConfig } from '@playwright/test';

// 기본은 Chrome이다. BROWSER=firefox 또는 BROWSER=webkit으로 다른 엔진에서 같은 검사를 돌린다.
const browserName = ['firefox', 'webkit'].includes(process.env.BROWSER)
  ? process.env.BROWSER
  : 'chromium';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4180',
    viewport: { width: 1440, height: 960 },
    headless: true,
    browserName,
    ...(browserName === 'chromium'
      ? {
          channel: process.env.CI ? undefined : 'chrome',
          launchOptions: { args: ['--enable-unsafe-swiftshader'] },
        }
      : {}),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4180',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: !process.env.CI,
  },
});
