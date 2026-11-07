import { defineConfig } from '@playwright/test'
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8088'
const target = new URL(baseURL)
const localTLS = target.protocol === 'https:' && target.hostname === 'localhost'
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 2,
  use: {
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    launchOptions: {
      // Service Worker 不继承 context 的证书忽略选项，仅本地 CA 验收在浏览器层忽略。
      args: [
        '--lang=zh-CN',
        ...(localTLS ? ['--ignore-certificate-errors'] : []),
      ],
      env: {
        ...process.env,
        LANG: 'zh_CN.UTF-8',
        LC_ALL: 'zh_CN.UTF-8',
        LANGUAGE: 'zh_CN:zh',
      },
    },
    baseURL,
    ignoreHTTPSErrors: true,
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
