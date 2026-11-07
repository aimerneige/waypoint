import { useEffect, useRef, useState } from 'react'
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
GlobalWorkerOptions.workerSrc = worker

function Page({
  document,
  number,
  scale,
}: {
  document: PDFDocumentProxy
  number: number
  scale: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    let task:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>
      | undefined
    void document
      .getPage(number)
      .then((page) => {
        if (cancelled || !ref.current) return
        const viewport = page.getViewport({ scale })
        ref.current.width = viewport.width
        ref.current.height = viewport.height
        task = page.render({ canvas: ref.current, viewport })
        return task.promise.then(() => {
          if (!cancelled && ref.current) ref.current.dataset.rendered = 'true'
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) console.error(error)
      })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [document, number, scale])
  return <canvas ref={ref} aria-label={`PDF 第 ${number} 页`} />
}
export default function VoucherPDF({ blob }: { blob: Blob }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [scale, setScale] = useState(0.5)
  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof getDocument> | undefined
    void blob
      .arrayBuffer()
      .then((buffer) => {
        if (cancelled) return
        task = getDocument({ data: buffer })
        return task.promise
      })
      .then((pdf) => {
        if (!cancelled && pdf) setDocument(pdf)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [blob])
  return (
    <div className="stack" data-testid="pdf-viewer">
      <label>
        PDF 缩放
        <input
          type="range"
          min="0.3"
          max="2"
          step="0.1"
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {!document && !error && <p role="status">正在加载 PDF…</p>}
      <div className="voucher-pages">
        {document &&
          Array.from({ length: document.numPages }, (_, i) => (
            <Page key={i} document={document} number={i + 1} scale={scale} />
          ))}
      </div>
    </div>
  )
}
