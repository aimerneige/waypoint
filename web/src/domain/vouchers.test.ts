import { describe, expect, it } from 'vitest'
import { detectFile, offlineState, prepareFile } from './vouchers'
describe('凭证文件', () => {
  it('按魔数识别 HEIC，忽略文件名和声明类型', async () => {
    const heic = new File(
      [new Uint8Array([0, 0, 0, 24]), 'ftypheic', new Uint8Array(12)],
      'image.png',
      { type: 'image/png' },
    )
    expect(await detectFile(heic)).toBe('image/heic')
    expect(
      await detectFile(
        new File(['not heic'], 'fake.heic', { type: 'image/heic' }),
      ),
    ).toBeNull()
    expect(await detectFile(new Blob(['%PDF-1.4']))).toBe('application/pdf')
    expect(
      await detectFile(
        new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]),
      ),
    ).toBe('image/png')
  })
  it('32MB 上限在解码前执行', async () => {
    await expect(
      prepareFile(new File([new Uint8Array(33 * 1024 * 1024)], 'large.pdf')),
    ).rejects.toThrow('32MB')
    const file = await prepareFile(
      new File(['%PDF-1.4'], 'ticket.png', { type: 'image/png' }),
    )
    expect(file.type).toBe('application/pdf')
  })
  it('离线选择优先于自动下载状态，允许取消与重新离线', () => {
    expect(offlineState(false, false, false)).toBe('missing')
    expect(offlineState(false, false, true)).toBe('downloading')
    expect(offlineState(false, true, false)).toBe('cached')
    expect(offlineState(true, false, true)).toBe('disabled')
    expect(offlineState(false, false, false)).toBe('missing')
  })
})
