import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  FileText,
  Hotel,
  Plane,
  Ticket,
  ShieldCheck,
  Lock,
  File,
} from 'lucide-react'
import {
  database,
  writeEntity,
  type Database,
  type Entity,
  type Pending,
} from '@/data/db'
import { useEntities } from '@/data/hooks'
import { fileEvents, downloading, setOffline } from '@/data/voucher-files'
import {
  fileSize,
  voucherTypes,
  prepareFile,
  type VoucherType,
  offlineState,
  sha256,
} from '@/domain/vouchers'
import { formatDate } from '@/domain/format'
import { pick } from '@/platform/pick'
import { storage } from '@/platform/storage'
import { useSession } from '@/platform/session'
import { ActionMenu } from '@/ui/action-menu'
import { ListCard } from '@/ui/list-card'
import { ResponsiveOverlay } from '@/ui/responsive-overlay'
import { Fab } from '@/ui/shell'
import { Button } from '@/ui/components/button'
import { toast } from '@/ui/components/sonner'
import { VoucherViewer } from './voucher-viewer'
import { HistoryList } from './itinerary'

const icons = {
  flight: Plane,
  hotel: Hotel,
  ticket: Ticket,
  visa: FileText,
  insurance: ShieldCheck,
  other: File,
}
export function VoucherRetry({
  db,
  retry,
  done,
}: {
  db: Database
  retry: Pending
  done: () => Promise<void>
}) {
  const [file, setFile] = useState<globalThis.File | null>(null)
  const [title, setTitle] = useState(String(retry.fields.title ?? ''))
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        try {
          const fields: Pending['fields'] = {
            ...retry.fields,
            ...(title ? { title } : {}),
          }
          if (retry.kind === 'update') delete fields.visibility
          if (file)
            Object.assign(fields, {
              fileId: crypto.randomUUID(),
              mime: file.type,
              size: file.size,
            })
          await db.transaction(
            'rw',
            [db.trips, db.entities, db.outbox, db.uploads, db.rejected],
            async () => {
              if (file)
                await db.uploads.put({
                  fileId: String(fields.fileId),
                  tripId: retry.tripId,
                  blob: file,
                  uploaded: false,
                  progress: 0,
                })
              await writeEntity(
                db,
                retry.tripId,
                'voucher',
                retry.entityId,
                retry.kind,
                fields,
              )
              await db.rejected.delete(retry.opId)
            },
          )
          await done()
        } catch (e) {
          toast.error(String(e))
        } finally {
          setBusy(false)
        }
      }}
    >
      <label>
        标题
        <input
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          try {
            const [picked] = await pick.pick()
            if (picked) setFile(await prepareFile(picked))
          } catch (e) {
            toast.error(String(e))
          }
        }}
      >
        重新选择文件
      </Button>
      {file && (
        <p>
          {file.name} · {fileSize(file.size)}
        </p>
      )}
      <Button loading={busy}>重试凭证</Button>
    </form>
  )
}
export function VoucherSelect({
  db,
  tripId,
  selected,
  onChange,
}: {
  db: Database
  tripId: string
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const vouchers = useEntities(db, tripId, 'voucher')
  return (
    <fieldset className="stack">
      <legend>关联凭证</legend>
      {!vouchers.length && <p className="muted">暂无可关联凭证</p>}
      {vouchers.map((v) => (
        <label className="member-check" key={v.entityId}>
          <input
            type="checkbox"
            checked={selected.includes(v.entityId)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, v.entityId]
                  : selected.filter((id) => id !== v.entityId),
              )
            }
          />
          {String(v.view!.fields.title)}
        </label>
      ))}
    </fieldset>
  )
}

function VoucherEditor({
  db,
  tripId,
  file,
  voucher,
  done,
}: {
  db: Database
  tripId: string
  file: File | null
  voucher: Entity | null
  done: () => void
}) {
  const f = voucher?.view?.fields
  const [type, setType] = useState<VoucherType>(
    (f?.type as VoucherType) ?? 'other',
  )
  const [title, setTitle] = useState(String(f?.title ?? file?.name ?? ''))
  const [note, setNote] = useState(String(f?.note ?? ''))
  const [visibility, setVisibility] = useState(String(f?.visibility ?? 'trip'))
  const [selected, setSelected] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const items = useEntities(db, tripId, 'itinerary_item')
  const linked =
    selected ??
    items
      .filter((i) =>
        (i.view!.fields.voucherIds as string[] | undefined)?.includes(
          voucher?.entityId ?? '',
        ),
      )
      .map((i) => i.entityId)
  const expired = useSession((s) => s.status !== 'authenticated')
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          const id = voucher?.entityId ?? crypto.randomUUID(),
            fileId = String(f?.fileId ?? crypto.randomUUID())
          const hash = file ? await sha256(file) : ''
          await db.transaction(
            'rw',
            [db.trips, db.entities, db.outbox, db.uploads],
            async () => {
              if (file)
                await db.uploads.put({
                  tripId,
                  fileId,
                  blob: file,
                  uploaded: false,
                  progress: 0,
                  sha256: hash,
                })
              await writeEntity(
                db,
                tripId,
                'voucher',
                id,
                voucher ? 'update' : 'create',
                voucher
                  ? { title, type, note }
                  : {
                      title,
                      type,
                      note,
                      visibility,
                      fileId,
                      mime: file!.type,
                      size: file!.size,
                    },
              )
              for (const item of items) {
                const old =
                  (item.view!.fields.voucherIds as string[] | undefined) ?? []
                const next = linked.includes(item.entityId)
                  ? [...new Set([...old, id])]
                  : old.filter((v) => v !== id)
                if (JSON.stringify(old) !== JSON.stringify(next))
                  await writeEntity(
                    db,
                    tripId,
                    'itinerary_item',
                    item.entityId,
                    'update',
                    { voucherIds: next },
                  )
              }
            },
          )
          done()
        } catch (error) {
          toast.error(String(error))
        } finally {
          setBusy(false)
        }
      }}
    >
      {file && (
        <p>
          {file.name} · {fileSize(file.size)}
        </p>
      )}
      <label>
        类型
        <select
          aria-label="类型"
          value={type}
          onChange={(e) => {
            const value = e.target.value as VoucherType
            setType(value)
            if (!voucher)
              setVisibility(
                ['visa', 'insurance'].includes(value) ? 'private' : 'trip',
              )
          }}
        >
          {Object.entries(voucherTypes).map(([v, name]) => (
            <option key={v} value={v}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        标题
        <input
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      {!voucher && (
        <label>
          可见性
          <select
            aria-label="可见性"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            <option value="trip">全组可见</option>
            <option value="private">仅自己可见</option>
          </select>
        </label>
      )}
      <label>
        备注
        <textarea
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <fieldset className="stack">
        <legend>关联到行程项</legend>
        {items.map((i) => (
          <label key={i.entityId} className="member-check">
            <input
              type="checkbox"
              checked={linked.includes(i.entityId)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...linked, i.entityId]
                    : linked.filter((id) => id !== i.entityId),
                )
              }
            />
            {formatDate(String(i.view!.fields.date))} ·{' '}
            {String(i.view!.fields.title)}
          </label>
        ))}
      </fieldset>
      <Button loading={busy} disabled={expired}>
        保存凭证
      </Button>
    </form>
  )
}

export function Vouchers() {
  const { tripId = '' } = useParams(),
    user = useSession((s) => s.currentUser)!,
    db = database(user.id)
  const vouchers = useEntities(db, tripId, 'voucher')
  const trip = useLiveQuery(() => db.trips.get(tripId), [db, tripId])
  const uploads = useLiveQuery(
    () => db.uploads.where('tripId').equals(tripId).toArray(),
    [db, tripId],
    [],
  )
  const prefs = useLiveQuery(() => db.meta.toArray(), [db], [])
  const [revision, setRevision] = useState(0)
  const [files, setFiles] = useState<string[]>([]),
    [usage, setUsage] = useState(0)
  const [editor, setEditor] = useState<{
    file: File | null
    voucher: Entity | null
  } | null>(null)
  const [view, setView] = useState<Entity | null>(null),
    [history, setHistory] = useState<Entity | null>(null)
  const [visibility, setVisibility] = useState<Entity | null>(null)
  const [busy, setBusy] = useState(false)
  const expired = useSession((s) => s.status !== 'authenticated')
  useEffect(() => {
    const refresh = () => setRevision((n) => n + 1)
    fileEvents.addEventListener('change', refresh)
    return () => fileEvents.removeEventListener('change', refresh)
  }, [])
  useEffect(() => {
    let active = true
    void Promise.all([storage.list(user.id), storage.usage(user.id)])
      .then(([list, bytes]) => {
        if (active) {
          setFiles(list)
          setUsage(bytes)
        }
      })
      .catch((e) => toast.error(String(e)))
    return () => {
      active = false
    }
  }, [user.id, revision, uploads])
  return (
    <main className="page stack">
      <div className="row">
        <h1>凭证</h1>
        <Link to="../more">更多</Link>
      </div>
      <p role="status">离线占用空间：{fileSize(usage)}</p>
      {!vouchers.length && (
        <p className="muted">保存机票、酒店和旅行文件，离线也能随时查看。</p>
      )}
      {Object.entries(voucherTypes).map(([type, label]) => {
        const group = vouchers.filter((v) => v.view!.fields.type === type),
          Icon = icons[type as VoucherType]
        return (
          group.length > 0 && (
            <section className="stack" key={type}>
              <h2 className="row">
                <Icon size={20} />
                {label}
              </h2>
              {group.map((v) => {
                const f = v.view!.fields,
                  fileId = String(f.fileId),
                  queue = uploads.find((u) => u.fileId === fileId)
                const state = offlineState(
                  !!prefs.find((p) => p.key === `offline-disabled:${fileId}`)
                    ?.value,
                  files.includes(fileId),
                  downloading(db, fileId),
                )
                const own = v.view!.createdBy === user.id
                return (
                  <article key={v.entityId} data-testid="voucher-card">
                    <ListCard
                      title={
                        <button
                          className="item-main"
                          onClick={() => setView(v)}
                        >
                          <strong>{String(f.title)}</strong>
                        </button>
                      }
                      status={
                        queue && !queue.uploaded
                          ? `待上传${queue.progress ? ` · 上传中 ${queue.progress}%` : ''}`
                          : {
                              cached: '已离线可用',
                              downloading: '下载中',
                              disabled: '未离线',
                              missing: '未离线',
                            }[state]
                      }
                      secondary={
                        <span className="row">
                          <Icon size={16} />
                          {label} · {fileSize(Number(f.size))} ·{' '}
                          {f.visibility === 'private' ? (
                            <>
                              <Lock size={14} aria-label="仅自己可见" />
                              仅自己可见
                            </>
                          ) : (
                            '全组可见'
                          )}
                        </span>
                      }
                      description={f.note ? String(f.note) : undefined}
                      menu={
                        <ActionMenu
                          label={`凭证操作 ${f.title}`}
                          actions={[
                            {
                              label:
                                state === 'disabled' || state === 'missing'
                                  ? '重新离线'
                                  : '取消离线',
                              onSelect: () =>
                                setOffline(
                                  db,
                                  tripId,
                                  fileId,
                                  Number(f.size),
                                  state === 'disabled' || state === 'missing',
                                ),
                            },
                            {
                              label: '修改记录',
                              onSelect: () => setHistory(v),
                            },
                            ...(own
                              ? [
                                  {
                                    label: '编辑凭证',
                                    disabled: expired,
                                    onSelect: () =>
                                      setEditor({ file: null, voucher: v }),
                                  },
                                  {
                                    label: '更改可见性',
                                    disabled: expired,
                                    onSelect: () => setVisibility(v),
                                  },
                                ]
                              : []),
                            ...(own ||
                            (trip?.role === 'owner' && f.visibility === 'trip')
                              ? [
                                  {
                                    label: '删除凭证',
                                    danger: true,
                                    disabled: expired,
                                    onSelect: async () => {
                                      await writeEntity(
                                        db,
                                        tripId,
                                        'voucher',
                                        v.entityId,
                                        'delete',
                                      )
                                      toast.success('凭证已删除', {
                                        action: {
                                          label: '撤销',
                                          onClick: () => {
                                            void writeEntity(
                                              db,
                                              tripId,
                                              'voucher',
                                              v.entityId,
                                              'restore',
                                            ).catch((e) =>
                                              toast.error(String(e)),
                                            )
                                          },
                                        },
                                      })
                                    },
                                  },
                                ]
                              : []),
                          ]}
                        />
                      }
                    />
                  </article>
                )
              })}
            </section>
          )
        )
      })}
      <Fab
        aria-label="上传凭证"
        disabled={expired || busy}
        onClick={async () => {
          try {
            const [file] = await pick.pick()
            if (!file) return
            setBusy(true)
            const prepared = await prepareFile(file)
            setEditor({ file: prepared, voucher: null })
          } catch (e) {
            toast.error(String(e))
          } finally {
            setBusy(false)
          }
        }}
      />
      {busy && <p role="status">正在处理文件…</p>}
      <ResponsiveOverlay
        open={!!editor}
        onOpenChange={(open) => {
          if (!open) setEditor(null)
        }}
        title={editor?.voucher ? '编辑凭证' : '上传凭证'}
      >
        {editor && (
          <VoucherEditor
            key={editor.voucher?.entityId ?? editor.file?.name}
            db={db}
            tripId={tripId}
            {...editor}
            done={() => setEditor(null)}
          />
        )}
      </ResponsiveOverlay>
      <VoucherViewer
        db={db}
        tripId={tripId}
        voucher={view}
        onClose={() => setView(null)}
      />
      <ResponsiveOverlay
        open={!!history}
        onOpenChange={(open) => {
          if (!open) setHistory(null)
        }}
        title="凭证修改记录"
      >
        {history && (
          <HistoryList
            db={db}
            tripId={tripId}
            entity="voucher"
            entityId={history.entityId}
          />
        )}
      </ResponsiveOverlay>
      <ResponsiveOverlay
        open={!!visibility}
        onOpenChange={(open) => {
          if (!open) setVisibility(null)
        }}
        title="更改可见性"
      >
        <p>将用同一文件创建新凭证，并删除旧凭证。</p>
        {visibility?.view!.fields.visibility === 'trip' && (
          <p role="alert">他人设备上已缓存的旧文件无法远程清除</p>
        )}
        <Button
          disabled={expired || busy}
          onClick={async () => {
            if (!visibility) return
            setBusy(true)
            try {
              const id = crypto.randomUUID()
              await db.transaction(
                'rw',
                db.trips,
                db.entities,
                db.outbox,
                async () => {
                  await writeEntity(db, tripId, 'voucher', id, 'create', {
                    ...visibility.view!.fields,
                    visibility:
                      visibility.view!.fields.visibility === 'trip'
                        ? 'private'
                        : 'trip',
                  })
                  const items = await db.entities
                    .where('[tripId+entity]')
                    .equals([tripId, 'itinerary_item'])
                    .toArray()
                  for (const item of items) {
                    const ids = item.view?.fields.voucherIds as
                      string[] | undefined
                    if (ids?.includes(visibility.entityId))
                      await writeEntity(
                        db,
                        tripId,
                        'itinerary_item',
                        item.entityId,
                        'update',
                        {
                          voucherIds: ids.map((v) =>
                            v === visibility.entityId ? id : v,
                          ),
                        },
                      )
                  }
                  await writeEntity(
                    db,
                    tripId,
                    'voucher',
                    visibility.entityId,
                    'delete',
                  )
                },
              )
              setVisibility(null)
            } catch (e) {
              toast.error(String(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          确认更改为
          {visibility?.view!.fields.visibility === 'trip'
            ? '仅自己可见'
            : '全组可见'}
        </Button>
      </ResponsiveOverlay>
    </main>
  )
}
