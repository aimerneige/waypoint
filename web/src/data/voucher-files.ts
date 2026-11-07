import { apiFetch, apiUpload, ApiError } from '@/api/client'
import { storage } from '@/platform/storage'
import { sha256 } from '@/domain/vouchers'
import { recomputeTrip, type Database, type Pending } from './db'

export const fileEvents = new EventTarget()
const changed = () => fileEvents.dispatchEvent(new Event('change'))
const downloads = new Map<string, Promise<Blob>>()
export async function settleFileDownloads(userId: string) {
  await Promise.allSettled(
    [...downloads]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([, work]) => work),
  )
}
export const downloading = (db: Database, id: string) =>
  downloads.has(`${db.userId}:${id}`)
export async function uploadDependencies(
  db: Database,
  batch: Pending[],
  active: () => boolean = () => true,
) {
  const ready: Pending[] = []
  for (const op of batch) {
    if (!active()) return []
    if (op.entity === 'voucher' && (op.kind === 'create' || op.fields.fileId)) {
      const fileId = String(op.fields.fileId)
      const queued = await db.uploads.get(fileId)
      if (queued && !queued.uploaded) {
        try {
          await db.uploads.update(fileId, { progress: 1 })
          let lastProgress = 1
          const data = await apiUpload(
            `/api/trips/${op.tripId}/files/${fileId}`,
            queued.blob,
            (progress) => {
              if (progress <= lastProgress || !active()) return
              lastProgress = progress
              void db.uploads.update(fileId, { progress }).catch(() => {
                /* 上传完成或重试会覆盖瞬时进度。 */
              })
            },
          )
          if (!active()) return []
          await db.uploads.update(fileId, {
            uploaded: true,
            progress: 100,
            sha256: data.sha256,
          })
        } catch (error) {
          if (!active()) return []
          if (
            error instanceof ApiError &&
            [409, 413, 415].includes(error.status)
          ) {
            const message = {
              409: '文件冲突',
              413: '文件过大',
              415: '格式不支持',
            }[error.status]!
            await db.transaction(
              'rw',
              db.outbox,
              db.rejected,
              db.entities,
              async () => {
                await db.rejected.put({
                  ...op,
                  error: { code: error.code, message },
                })
                await db.outbox.delete(op.localId!)
                await recomputeTrip(db, op.tripId)
              },
            )
            continue
          }
          throw error
        }
      }
    }
    ready.push(op)
  }
  return ready
}
async function verifiedCache(db: Database, fileId: string, size: number) {
  const blob = await storage.get(db.userId, fileId)
  if (!blob) return null
  const hash = (await db.meta.get(`file-hash:${fileId}`))?.value
  if (
    blob.size === size &&
    typeof hash === 'string' &&
    (await sha256(blob)) === hash
  )
    return blob
  await storage.delete(db.userId, fileId)
  return null
}
export async function readVoucher(
  db: Database,
  tripId: string,
  fileId: string,
  size: number,
): Promise<Blob> {
  const queued = await db.uploads.get(fileId)
  if (queued) return queued.blob
  const blob = await verifiedCache(db, fileId, size)
  if (blob) return blob
  if (!navigator.onLine) throw new Error('该凭证尚未离线，请联网后下载')
  const response = await apiFetch(
    new URL(`/api/trips/${tripId}/files/${fileId}/link`, location.origin),
    { method: 'POST' },
  )
  const link = (await response.json()) as { url: string; sha256: string }
  const result = await fetch(link.url, { signal: AbortSignal.timeout(15000) })
  if (!result.ok) throw new Error('下载失败，请重试')
  const file = await result.blob()
  if (file.size !== size || (await sha256(file)) !== link.sha256)
    throw new Error('文件校验失败，请重试')
  return file
}
export function cacheVoucher(
  db: Database,
  tripId: string,
  fileId: string,
  size: number,
  active: () => boolean = () => true,
) {
  const key = `${db.userId}:${fileId}`
  const existing = downloads.get(key)
  if (existing) return existing
  const work = (async () => {
    const cached = await verifiedCache(db, fileId, size)
    if (cached) return cached
    const file = await readVoucher(db, tripId, fileId, size)
    if (
      active() &&
      db.isOpen() &&
      !(await db.meta.get(`offline-disabled:${fileId}`))?.value
    ) {
      await storage.put(db.userId, fileId, file)
      await db.meta.put({
        key: `file-hash:${fileId}`,
        value: await sha256(file),
      })
    }
    return file
  })().finally(() => {
    downloads.delete(key)
    changed()
  })
  downloads.set(key, work)
  changed()
  return work
}
export async function setOffline(
  db: Database,
  tripId: string,
  fileId: string,
  size: number,
  enabled: boolean,
) {
  await db.meta.put({ key: `offline-disabled:${fileId}`, value: !enabled })
  if (enabled) await cacheVoucher(db, tripId, fileId, size)
  else await storage.delete(db.userId, fileId)
  changed()
}
let cacheWork = Promise.resolve()
const cacheTrips = new Map<string, Promise<void>>()
export function autoCache(db: Database, tripId: string, active: () => boolean) {
  const key = `${db.userId}:${tripId}`
  const existing = cacheTrips.get(key)
  if (existing) return existing
  // 行程之间排队，每个行程两个下载任务，整个同步引擎最多并发两个文件。
  const work = cacheWork
    .then(() => (active() ? cacheTrip(db, tripId, active) : undefined))
    .finally(() => cacheTrips.delete(key))
  cacheTrips.set(key, work)
  cacheWork = work.catch(() => {
    /* 后续行程仍可下载。 */
  })
  return work
}
async function cacheTrip(db: Database, tripId: string, active: () => boolean) {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection
  if (!navigator.onLine || connection?.saveData || !('caches' in globalThis))
    return
  const queue = (
    await db.entities
      .where('[tripId+entity]')
      .equals([tripId, 'voucher'])
      .toArray()
  ).filter((r) => r.view && !r.view.deleted)
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      let row
      while (active() && (row = queue.shift())) {
        const f = row.view!.fields,
          id = String(f.fileId)
        if ((await db.meta.get(`offline-disabled:${id}`))?.value) continue
        try {
          await cacheVoucher(db, tripId, id, Number(f.size), active)
        } catch {
          /* 缓存失败不影响结构化同步，下轮同步或手动下载可重试。 */
        }
      }
    }),
  )
  if (!active()) return
  const pending = await db.outbox.where('tripId').equals(tripId).toArray()
  for (const upload of await db.uploads
    .where('tripId')
    .equals(tripId)
    .toArray()) {
    if (
      !upload.uploaded ||
      pending.some((op) => op.fields.fileId === upload.fileId)
    )
      continue
    if (
      (await storage.get(db.userId, upload.fileId)) ||
      (await db.meta.get(`offline-disabled:${upload.fileId}`))?.value
    )
      await db.uploads.delete(upload.fileId)
  }
}
