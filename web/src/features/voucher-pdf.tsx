import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api'
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Button } from '@/ui/components/button'
GlobalWorkerOptions.workerSrc = worker

const HORIZONTAL_PADDING = 16

function Page({
  document,
  number,
  targetWidth,
  onBaseSize,
}: {
  document: PDFDocumentProxy
  number: number
  targetWidth: number
  onBaseSize?: (size: { width: number; height: number }) => void
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
        const base = page.getViewport({ scale: 1 })
        onBaseSize?.({ width: base.width, height: base.height })
        const scale = targetWidth / base.width
        const viewport = page.getViewport({ scale })
        const w = Math.max(1, Math.round(viewport.width))
        const h = Math.max(1, Math.round(viewport.height))
        ref.current.width = w
        ref.current.height = h
        ref.current.style.width = `${w}px`
        ref.current.style.height = `${h}px`
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
  }, [document, number, targetWidth, onBaseSize])
  return <canvas ref={ref} aria-label={`PDF 第 ${number} 页`} />
}

export default function VoucherPDF({ blob }: { blob: Blob }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [visiblePages, setVisiblePages] = useState<Set<number>>(
    () => new Set([1, 2]),
  )
  const [baseSize, setBaseSize] = useState({ width: 420, height: 300 })
  const [containerWidth, setContainerWidth] = useState(() =>
    Math.max(
      200,
      (typeof window !== 'undefined' ? window.innerWidth : 375) -
        HORIZONTAL_PADDING,
    ),
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null)

  const handleBaseSize = useCallback(
    (size: { width: number; height: number }) => {
      setBaseSize((prev) =>
        prev.width === size.width && prev.height === size.height ? prev : size,
      )
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof getDocument> | undefined
    void blob
      .arrayBuffer()
      .then((buffer) => {
        if (cancelled) return
        task = getDocument({
          data: buffer,
          isEvalSupported: false,
        } as DocumentInitParameters)
        return task.promise
      })
      .then(async (pdf) => {
        if (cancelled || !pdf) return
        const first = await pdf.getPage(1)
        if (cancelled) return
        const vp = first.getViewport({ scale: 1 })
        setBaseSize({ width: vp.width, height: vp.height })
        setCurrentPage(1)
        setVisiblePages(new Set([1, 2]))
        setDocument(pdf)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [blob])

  useEffect(() => {
    const el = scrollRef.current
    const updateWidth = () => {
      const raw = el && el.clientWidth > 0 ? el.clientWidth : window.innerWidth
      setContainerWidth(Math.max(200, raw - HORIZONTAL_PADDING))
    }
    updateWidth()
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(updateWidth)
        : null
    if (el && observer) observer.observe(el)
    window.addEventListener('resize', updateWidth)
    window.addEventListener('orientationchange', updateWidth)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateWidth)
      window.removeEventListener('orientationchange', updateWidth)
    }
  }, [document])

  useEffect(() => {
    const root = scrollRef.current
    if (!root || !document || typeof IntersectionObserver === 'undefined')
      return
    const intersecting = new Set<number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const num = Number((entry.target as HTMLElement).dataset.page ?? '0')
          if (!num) continue
          if (entry.isIntersecting) intersecting.add(num)
          else intersecting.delete(num)
        }
        setVisiblePages(new Set(intersecting))
      },
      { root, rootMargin: '100% 0px' },
    )
    for (const node of root.querySelectorAll<HTMLElement>('[data-page]')) {
      observer.observe(node)
    }
    return () => observer.disconnect()
  }, [document])

  const targetWidth = Math.max(100, Math.round(containerWidth * zoom))
  const slotHeight = Math.max(
    80,
    Math.round(baseSize.height * (targetWidth / baseSize.width)),
  )

  return (
    <div className="voucher-pdf" data-testid="pdf-viewer">
      {error && (
        <p className="viewer-status" role="alert">
          {error}
        </p>
      )}
      {!document && !error && (
        <p className="viewer-status" role="status">
          正在加载 PDF…
        </p>
      )}
      <div
        ref={scrollRef}
        className="voucher-pages"
        onScroll={(e) => {
          const container = e.currentTarget
          const slots = container.querySelectorAll<HTMLElement>('[data-page]')
          if (!slots.length) return
          const center = container.scrollTop + container.clientHeight / 2
          let best = 1
          let bestDist = Infinity
          for (const slot of slots) {
            const num = Number(slot.dataset.page ?? '1')
            const mid = slot.offsetTop + slot.offsetHeight / 2
            const dist = Math.abs(mid - center)
            if (dist < bestDist) {
              bestDist = dist
              best = num
            }
          }
          setCurrentPage(best)
        }}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            const delta = e.deltaY < 0 ? 0.1 : -0.1
            setZoom((z) =>
              Math.min(3, Math.max(0.5, Math.round((z + delta) * 100) / 100)),
            )
          }
        }}
        onTouchStart={(e) => {
          if (e.touches.length === 2) {
            const [t0, t1] = [e.touches[0], e.touches[1]]
            pinchRef.current = {
              dist: Math.hypot(
                t1.clientX - t0.clientX,
                t1.clientY - t0.clientY,
              ),
              zoom,
            }
          }
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2 && pinchRef.current) {
            const [t0, t1] = [e.touches[0], e.touches[1]]
            const dist = Math.hypot(
              t1.clientX - t0.clientX,
              t1.clientY - t0.clientY,
            )
            if (pinchRef.current.dist > 0) {
              const next =
                pinchRef.current.zoom * (dist / pinchRef.current.dist)
              setZoom(Math.min(3, Math.max(0.5, Math.round(next * 20) / 20)))
            }
          }
        }}
        onTouchEnd={() => {
          pinchRef.current = null
        }}
      >
        {document &&
          Array.from({ length: document.numPages }, (_, i) => {
            const pageNumber = i + 1
            const shouldRender =
              visiblePages.has(pageNumber) ||
              Math.abs(pageNumber - currentPage) <= 1
            return (
              <div
                key={pageNumber}
                data-page={pageNumber}
                className="voucher-page-slot"
                style={{
                  width: `${targetWidth}px`,
                  minHeight: `${slotHeight}px`,
                }}
              >
                {shouldRender && (
                  <Page
                    document={document}
                    number={pageNumber}
                    targetWidth={targetWidth}
                    onBaseSize={pageNumber === 1 ? handleBaseSize : undefined}
                  />
                )}
              </div>
            )
          })}
      </div>
      {document && (
        <div className="pdf-hud" role="group" aria-label="PDF 缩放">
          <Button
            variant="ghost"
            className="viewer-icon-btn"
            aria-label="缩小 PDF"
            disabled={zoom <= 0.5}
            onClick={() =>
              setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))
            }
          >
            −
          </Button>
          <span className="pdf-page-indicator" data-testid="pdf-page-indicator">
            第 {currentPage} / {document.numPages} 页
          </span>
          <Button
            variant="ghost"
            className="viewer-icon-btn"
            aria-label="放大 PDF"
            disabled={zoom >= 3}
            onClick={() =>
              setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))
            }
          >
            +
          </Button>
        </div>
      )}
    </div>
  )
}
