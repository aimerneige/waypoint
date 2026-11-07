export const voucherTypes = {
  flight: '机票',
  hotel: '酒店',
  ticket: '门票',
  visa: '签证',
  insurance: '保险',
  other: '其他',
} as const
export type VoucherType = keyof typeof voucherTypes
export const fileSize = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${(n / 1024).toFixed(1)} KB`
export async function detectFile(blob: Blob): Promise<string | null> {
  const bytes = new Uint8Array(await blob.slice(0, 64).arrayBuffer())
  const starts = (values: number[]) => values.every((v, i) => bytes[i] === v)
  if (starts([37, 80, 68, 70, 45])) return 'application/pdf'
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png'
  if (starts([255, 216, 255])) return 'image/jpeg'
  const text = new TextDecoder().decode(bytes)
  if (
    text.slice(4, 8) === 'ftyp' &&
    /heic|heix|hevc|hevx|mif1|msf1/.test(text.slice(8))
  )
    return 'image/heic'
  return null
}
export async function prepareFile(file: File): Promise<File> {
  if (file.size > 32 * 1024 * 1024)
    throw new Error('文件过大，单个文件不能超过 32MB')
  const mime = await detectFile(file)
  if (!mime) throw new Error('格式不支持，请选择 PDF、JPEG、PNG 或 HEIC')
  if (mime === 'image/heic') {
    const { convertHeic } = await import('./heic')
    const blob = await convertHeic(file, 0.9)
    if (blob.size > 32 * 1024 * 1024)
      throw new Error('转换后的文件过大，不能超过 32MB')
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
    })
  }
  return new File([file], file.name, { type: mime })
}
export type OfflineState = 'disabled' | 'cached' | 'downloading' | 'missing'
export function offlineState(
  disabled: boolean,
  cached: boolean,
  downloading: boolean,
): OfflineState {
  return disabled
    ? 'disabled'
    : cached
      ? 'cached'
      : downloading
        ? 'downloading'
        : 'missing'
}
export async function sha256(blob: Blob) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
}
