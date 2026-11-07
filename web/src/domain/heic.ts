let worker: Worker | null = null
let seq = 0

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./heic-worker.ts', import.meta.url), {
      type: 'module',
    })
  }
  return worker
}

function decodeInWorker(buffer: ArrayBuffer): Promise<{
  width: number
  height: number
  data: Uint8ClampedArray
}> {
  return new Promise((resolve, reject) => {
    const w = getWorker()
    const id = ++seq
    const onMessage = (
      event: MessageEvent<{
        id: number
        width?: number
        height?: number
        data?: Uint8ClampedArray
        error?: string
      }>,
    ) => {
      if (event.data?.id !== id) return
      cleanup()
      if (
        event.data.error ||
        !event.data.data ||
        !event.data.width ||
        !event.data.height
      ) {
        reject(new Error(event.data.error ?? 'HEIC 解码失败'))
        return
      }
      resolve({
        width: event.data.width,
        height: event.data.height,
        data: event.data.data,
      })
    }
    const onError = (event: ErrorEvent) => {
      cleanup()
      reject(new Error(event.message || 'HEIC 解码失败'))
    }
    const cleanup = () => {
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
    }
    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    w.postMessage({ id, buffer }, [buffer])
  })
}

export async function convertHeic(blob: Blob, quality = 0.9): Promise<Blob> {
  const buffer = await blob.arrayBuffer()
  const { width, height, data } = await decodeInWorker(buffer)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布上下文')
    const imageData = ctx.createImageData(width, height)
    imageData.data.set(data)
    ctx.putImageData(imageData, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) resolve(result)
          else reject(new Error('HEIC 转换 JPEG 失败'))
        },
        'image/jpeg',
        quality,
      )
    })
  } finally {
    canvas.width = 1
    canvas.height = 1
  }
}
