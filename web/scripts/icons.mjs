import sharp from 'sharp'
import { Buffer } from 'node:buffer'
// 图形在中央安全区内，maskable 裁切后仍保留完整罗盘。
const icon = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="0" fill="#1B65A6"/><circle cx="256" cy="256" r="140" fill="none" stroke="#E3F1FC" stroke-width="16"/><path d="M310 202L280 280L202 310L232 232Z" fill="#FFFFFF"/><circle cx="256" cy="256" r="12" fill="#1B65A6"/></svg>',
)
for (const size of [192, 512])
  for (const name of ['icon', 'icon-maskable'])
    await sharp(icon)
      .resize(size, size)
      .png()
      .toFile(`public/${name}-${size}.png`)
await sharp(icon).resize(180, 180).png().toFile('public/apple-touch-icon.png')
