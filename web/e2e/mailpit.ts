import { expect, type APIRequestContext } from '@playwright/test'
export async function latestMailLink(
  request: APIRequestContext,
  email: string,
  path: string,
) {
  const base = process.env.MAILPIT_URL ?? 'http://localhost:8025'
  let link = ''
  await expect
    .poll(
      async () => {
        const response = await request.get(`${base}/api/v1/messages`)
        const body = await response.json()
        const mail = body.messages.find((m: { To: { Address: string }[] }) =>
          m.To.some((to) => to.Address === email),
        )
        if (!mail) return false
        const detail = await (
          await request.get(`${base}/api/v1/message/${mail.ID}`)
        ).json()
        const found = String(detail.Text).match(
          new RegExp(`https?://[^\\s]+${path}\\?token=[^\\s]+`),
        )
        link = found?.[0] ?? ''
        return !!link
      },
      { timeout: 20000 },
    )
    .toBe(true)
  return link
}
