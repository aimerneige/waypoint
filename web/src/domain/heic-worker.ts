import initLibheif, {
  type MainModule,
} from 'libheif-js/libheif-wasm/libheif.js'
import wasmUrl from 'libheif-js/libheif-wasm/libheif.wasm?url'

interface HeifImage {
  get_width(): number
  get_height(): number
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    cb: (result: { data: Uint8ClampedArray } | null) => void,
  ): void
  free(): void
}

interface HeifDecoderInstance {
  decoder: Parameters<MainModule['heif_context_free']>[0] | null
  decode(buffer: Uint8Array): HeifImage[]
}

type LibheifModule = MainModule & {
  HeifDecoder: new () => HeifDecoderInstance
}

let modulePromise: Promise<LibheifModule> | null = null

function getLibheif(): Promise<LibheifModule> {
  if (!modulePromise) {
    modulePromise = fetch(wasmUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`WASM 加载失败: ${res.status}`)
        return res.arrayBuffer()
      })
      .then(
        (wasmBinary) =>
          initLibheif({
            wasmBinary: new Uint8Array(wasmBinary),
          }) as LibheifModule,
      )
      .catch((err) => {
        modulePromise = null
        throw err
      })
  }
  return modulePromise
}

export async function decodeHeicBuffer(buffer: ArrayBuffer): Promise<{
  width: number
  height: number
  data: Uint8ClampedArray
}> {
  const heif = await getLibheif()
  const decoder = new heif.HeifDecoder()
  const images = decoder.decode(new Uint8Array(buffer))
  if (!images.length) {
    if (decoder.decoder) heif.heif_context_free(decoder.decoder)
    throw new Error('HEIC 解码失败')
  }
  const primary = images[0]
  try {
    const width = primary.get_width()
    const height = primary.get_height()
    const data = new Uint8ClampedArray(width * height * 4)
    await new Promise<void>((resolve, reject) => {
      primary.display({ data, width, height }, (result) => {
        if (!result) reject(new Error('HEIC 解码失败'))
        else resolve()
      })
    })
    return { width, height, data }
  } finally {
    for (const img of images) img.free()
    if (decoder.decoder) heif.heif_context_free(decoder.decoder)
  }
}

if (
  typeof self !== 'undefined' &&
  'postMessage' in self &&
  typeof document === 'undefined'
) {
  self.addEventListener(
    'message',
    (event: MessageEvent<{ id: number; buffer: ArrayBuffer }>) => {
      const { id, buffer } = event.data
      void decodeHeicBuffer(buffer)
        .then(({ width, height, data }) => {
          ;(self as unknown as Worker).postMessage(
            { id, width, height, data },
            [data.buffer],
          )
        })
        .catch((error: unknown) => {
          ;(self as unknown as Worker).postMessage({
            id,
            error: error instanceof Error ? error.message : String(error),
          })
        })
    },
  )
}
