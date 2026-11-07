import { describe, expect, it } from 'vitest'
import { themes } from './tokens'
import { readFileSync } from 'node:fs'
export function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const c = hex
      .slice(1)
      .match(/../g)!
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722
  }
  const x = luminance(a),
    y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
describe('theme contrast and actual CSS', () => {
  for (const [name, tokens] of Object.entries(themes)) {
    it(name, () => {
      const css = readFileSync(
        new URL('../../style.css', import.meta.url),
        'utf8',
      )
      const selector = name === 'light' ? ':root' : '.dark'
      const block = css.slice(css.indexOf(`${selector} {`)).split('}')[0]
      for (const [key, value] of Object.entries(tokens))
        expect(block.toLowerCase()).toContain(
          `--${key}: ${value.toLowerCase()};`,
        )
      for (const [fg, bg] of [
        ['foreground', 'background'],
        ['primary-foreground', 'primary'],
        ['muted-foreground', 'background'],
        ['accent-foreground', 'accent'],
        ['destructive-foreground', 'destructive'],
        ['card-foreground', 'card'],
        ['popover-foreground', 'popover'],
        ['secondary-foreground', 'secondary'],
      ] as const) {
        const ratio = contrast(tokens[fg], tokens[bg])
        console.info(`${name} ${fg}/${bg}: ${ratio.toFixed(2)}`)
        expect(ratio).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})
