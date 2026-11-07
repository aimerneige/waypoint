import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import console from 'node:console'
import process from 'node:process'

// Vite 在 HTML 中列出入口及其静态依赖；不计后台预缓存或按需加载的业务模块。
const html = readFileSync('dist/index.html', 'utf8')
const files = new Set(
  [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((match) => match[1]),
)
let total = 0
for (const file of files) {
  const bytes = gzipSync(
    readFileSync(resolve('dist', file.replace(/^\//, ''))),
  ).length
  total += bytes
  console.log(`${file}: ${(bytes / 1000).toFixed(2)} KB gzip`)
}
console.log(`Initial JS: ${(total / 1000).toFixed(2)} KB gzip (budget 250 KB)`)
if (total > 250000) process.exitCode = 1
