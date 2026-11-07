export interface Sharing {
  share(data: ShareData): Promise<void>
}
export const share: Sharing = {
  async share(data) {
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
      await navigator.share(data)
      return
    }
    if (data.files?.length) {
      for (const file of data.files) {
        const url = URL.createObjectURL(file)
        const link = document.createElement('a')
        link.href = url
        link.download = file.name
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } else
      await navigator.clipboard.writeText(
        data.url ?? data.text ?? data.title ?? '',
      )
  },
}
