import { useEffect, useRef, useState } from 'react'
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { Button } from '@/ui/components/button'
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
      <div className="row" aria-label="PDF 缩放">
        <Button
          variant="outline"
          aria-label="缩小 PDF"
          disabled={scale <= 0.3}
          onClick={() => setScale(Math.max(0.3, scale - 0.1))}
        >
          −
        </Button>
        <span>{Math.round(scale * 100)}%</span>
        <Button
          variant="outline"
          aria-label="放大 PDF"
          disabled={scale >= 2}
          onClick={() => setScale(Math.min(2, scale + 0.1))}
        >
          +
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!document && !error && <p role="status">正在加载 PDF…</p>}
      <div className="voucher-pages">
        {document &&
          Array.from({ length: document.numPages }, (_, i) => (
            <section key={i}>
              <p>
                第 {i + 1} / {document.numPages} 页
              </p>
              <TransformWrapper>
                <TransformComponent>
                  <Page document={document} number={i + 1} scale={scale} />
                </TransformComponent>
              </TransformWrapper>
            </section>
          ))}
      </div>
    </div>
  )
}
