import { writeFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { URL } from 'node:url'
import sharp from 'sharp'
const root = new URL('./', import.meta.url)
await sharp({
  create: { width: 480, height: 320, channels: 3, background: '#e3f1fc' },
})
  .composite([
    {
      input: Buffer.from(
        '<svg width="480" height="320"><text x="30" y="120" font-size="32" fill="#173e60">Waypoint · Tokyo</text><text x="30" y="180" font-size="20" fill="#173e60">Travel voucher / offline ready</text></svg>',
      ),
    },
  ])
  .png()
  .toFile(new URL('ticket.png', root).pathname)
const stream =
  'BT /F1 24 Tf 40 240 Td (Waypoint - Tokyo Ticket) Tj 0 -40 Td (Offline PDF ready) Tj ET'
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
]
let pdf = '%PDF-1.4\n',
  offsets = [0]
for (const [i, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(pdf))
  pdf += `${i + 1} 0 obj\n${object}\nendobj\n`
}
const xref = Buffer.byteLength(pdf)
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
  .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
await writeFile(new URL('ticket.pdf', root), pdf)
