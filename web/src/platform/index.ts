export {}
export { auth } from './auth'
export interface FileStorage {
  read(key: string): Promise<Blob | null>
  write(key: string, file: Blob): Promise<void>
  remove(key: string): Promise<void>
}
// TODO M0.6：接入凭证文件缓存。
export const storage: FileStorage = {
  async read() {
    return null
  },
  async write() {
    throw new Error('凭证存储尚未接入')
  },
  async remove() {},
}
export interface Notifications {
  schedule(message: string, at: Date): Promise<void>
}
// TODO：提醒由应用内横幅消费，原生平台实现本地定时通知。
export const notify: Notifications = { async schedule() {} }
export interface Sharing {
  share(data: ShareData): Promise<void>
}
export const share: Sharing = {
  async share(data) {
    if (navigator.share && (!navigator.canShare || navigator.canShare(data)))
      await navigator.share(data)
    else
      await navigator.clipboard.writeText(
        data.url ?? data.text ?? data.title ?? '',
      )
  },
}
export interface FilePicker {
  pick(accept?: string): Promise<File[]>
}
export const pick: FilePicker = {
  pick(accept = '') {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = accept
      input.multiple = true
      input.onchange = () => resolve(Array.from(input.files ?? []))
      input.oncancel = () => resolve([])
      input.click()
    })
  },
}
