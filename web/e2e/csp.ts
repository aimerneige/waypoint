import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
  type APIRequestContext,
} from '@playwright/test'

function trackPage(page: Page, violations: string[]) {
  page.on('console', (msg) => {
    const text = msg.text()
    if (
      /Content Security Policy|\[CSP violation\]|securitypolicyviolation/i.test(
        text,
      )
    ) {
      violations.push(text)
    }
  })
}

async function trackContext(ctx: BrowserContext, violations: string[]) {
  await ctx.addInitScript(() => {
    window.addEventListener(
      'securitypolicyviolation',
      (e) => {
        console.error(
          `[CSP violation] ${e.effectiveDirective || e.violatedDirective} blocked ${e.blockedURI} (${e.sourceFile}:${e.lineNumber})`,
        )
      },
      true,
    )
  })
  for (const page of ctx.pages()) trackPage(page, violations)
  ctx.on('page', (page) => trackPage(page, violations))
}

export const test = base.extend<{ cspGuard: void }>({
  cspGuard: [
    async ({ browser, context }, use) => {
      const violations: string[] = []
      await trackContext(context, violations)
      const origNewContext = browser.newContext.bind(browser)
      browser.newContext = async (...args) => {
        const ctx = await origNewContext(...args)
        await trackContext(ctx, violations)
        return ctx
      }
      try {
        await use()
      } finally {
        browser.newContext = origNewContext
      }
      expect(violations, 'CSP violations').toEqual([])
    },
    { auto: true },
  ],
})

export { expect, type Page, type APIRequestContext }
