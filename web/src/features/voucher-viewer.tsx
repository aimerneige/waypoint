import { lazy, Suspense, useEffect, useState } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import type { Database, Entity } from '@/data/db'
import { useEntities } from '@/data/hooks'
import { readVoucher } from '@/data/voucher-files'
import { share } from '@/platform/share'
import { formatDate } from '@/domain/format'
import { ResponsiveOverlay } from '@/ui/responsive-overlay'
import { Button } from '@/ui/components/button'
import { toast } from '@/ui/components/sonner'
const PDF = lazy(() => import('./voucher-pdf'))

export function VoucherViewer({
  db,
  tripId,
  voucher,
  onClose,
}: {
  db: Database
  tripId: string
  voucher: Entity | null
  onClose: () => void
}) {
  const [loaded, setLoaded] = useState<{
    id: string
    blob: Blob
    url: string
  } | null>(null)
  const [error, setError] = useState('')
  const items = useEntities(db, tripId, 'itinerary_item')
  const f = voucher?.view?.fields
  const id = String(f?.fileId ?? '')
  const size = Number(f?.size ?? 0)
  useEffect(() => {
    if (!id) return
    let active = true,
      url = ''
    void readVoucher(db, tripId, id, size)
      .then((blob) => {
        if (!active) return
        url = URL.createObjectURL(blob)
        setLoaded({ id, blob, url })
        setError('')
      })
      .catch((e: unknown) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [db, tripId, id, size])
  const file = loaded?.id === id ? loaded : null
  return (
    <ResponsiveOverlay
      open={!!voucher}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={String(f?.title ?? '查看凭证')}
      fullHeight
    >
      {error && <p role="alert">{error}</p>}
      {!file && !error && <p role="status">正在打开凭证…</p>}
      {file && (
        <>
          {f?.mime === 'application/pdf' ? (
            <Suspense fallback={<p>正在加载 PDF…</p>}>
              <PDF blob={file.blob} />
            </Suspense>
          ) : (
            <div className="voucher-image" data-testid="image-viewer">
              <TransformWrapper>
                <TransformComponent>
                  <img src={file.url} alt={String(f?.title)} />
                </TransformComponent>
              </TransformWrapper>
            </div>
          )}
          <Button
            variant="outline"
            onClick={() => {
              void share
                .share({
                  title: String(f?.title),
                  files: [
                    new File(
                      [file.blob],
                      `${String(f?.title)}.${f?.mime === 'application/pdf' ? 'pdf' : f?.mime === 'image/png' ? 'png' : 'jpg'}`,
                      { type: file.blob.type },
                    ),
                  ],
                })
                .catch((e) => {
                  if (!(e instanceof DOMException && e.name === 'AbortError'))
                    toast.error(String(e))
                })
            }}
          >
            分享/保存
          </Button>
        </>
      )}
      {!!f?.note && <p>{String(f.note)}</p>}
      <h3>关联的行程</h3>
      {items
        .filter((i) =>
          (i.view!.fields.voucherIds as string[] | undefined)?.includes(
            voucher?.entityId ?? '',
          ),
        )
        .map((i) => (
          <p key={i.entityId}>
            {formatDate(String(i.view!.fields.date))} ·{' '}
            {String(i.view!.fields.title)}
          </p>
        ))}
    </ResponsiveOverlay>
  )
}

export function VoucherLinks({
  db,
  tripId,
  ids,
}: {
  db: Database
  tripId: string
  ids: string[]
}) {
  const vouchers = useEntities(db, tripId, 'voucher')
  const [view, setView] = useState<Entity | null>(null)
  return (
    <>
      <div className="row">
        {vouchers
          .filter((v) => ids.includes(v.entityId))
          .map((v) => (
            <Button
              key={v.entityId}
              variant="outline"
              onClick={() => setView(v)}
            >
              ▤ {String(v.view!.fields.title)}
            </Button>
          ))}
      </div>
      <VoucherViewer
        db={db}
        tripId={tripId}
        voucher={view}
        onClose={() => setView(null)}
      />
    </>
  )
}
