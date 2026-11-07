import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  use: {
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    launchOptions: {
      args: ['--lang=zh-CN'],
      env: {
        ...process.env,
        LANG: 'zh_CN.UTF-8',
        LC_ALL: 'zh_CN.UTF-8',
        LANGUAGE: 'zh_CN:zh',
      },
    },
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8088',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      use: {
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
})
