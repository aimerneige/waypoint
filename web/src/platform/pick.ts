export interface FilePicker {
  pick(accept?: string): Promise<File[]>
}
export const pick: FilePicker = {
  pick(accept = 'application/pdf,image/*') {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = accept
      input.onchange = () => resolve(Array.from(input.files ?? []))
      input.oncancel = () => resolve([])
      input.click()
    })
  },
}
