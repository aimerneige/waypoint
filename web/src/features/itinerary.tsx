import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  database,
  writeEntity,
  type Database,
  type Pending,
  type Notice,
  type Trip,
} from '@/data/db'
import { useEntities } from '@/data/hooks'
import { useSession } from '@/platform/session'
import { api } from '@/api/client'
import { useOnline } from '@/ui/hooks'
import { ResponsiveOverlay } from '@/ui/responsive-overlay'
import { Button } from '@/ui/components/button'
import { Card } from '@/ui/components/card'
import { toast } from '@/ui/components/sonner'
import { Fab } from '@/ui/shell'
import type { Op } from '@/domain/ops'

const labels: Record<string, string> = {
  title: '标题',
  date: '日期',
  place: '地点',
  deleted: '删除状态',
  name: '行程名',
  nickname: '昵称',
  role: '角色',
  ownerId: '所有者',
  startDate: '开始日期',
  endDate: '结束日期',
  leftAt: '退出时间',
  joinedAt: '加入时间',
  userId: '用户',
  timezone: '时区',
  baseCurrency: '结算币种',
  avatarUrl: '头像',
}
const value = (v: unknown) => (v == null ? '空' : String(v))
function useTripData() {
  const { tripId = '' } = useParams()
  const user = useSession((s) => s.currentUser)!
  return { tripId, db: database(user.id) }
}
export function ItemEditor({
  db,
  trip,
  entityId,
  initial,
  baseline = initial,
  kind,
  onSaved,
}: {
  db: Database
  trip: Trip
  entityId: string
  initial: Op['fields']
  baseline?: Op['fields']
  kind: Op['kind']
  onSaved: () => Promise<void> | void
}) {
  const [title, setTitle] = useState(String(initial.title ?? ''))
  const [date, setDate] = useState(String(initial.date ?? trip.startDate))
  const [place, setPlace] = useState(String(initial.place ?? ''))
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState(false)
  const expired = useSession((s) => s.status !== 'authenticated')
  return (
    <>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            const all = { title, date, place: place || null }
            const fields =
              kind === 'create'
                ? all
                : Object.fromEntries(
                    Object.entries(all).filter(
                      ([key, v]) => v !== (baseline[key] ?? null),
                    ),
                  )
            await writeEntity(
              db,
              trip.id,
              'itinerary_item',
              entityId,
              kind,
              fields,
            )
            await onSaved()
          } catch (error) {
            toast.error(String(error))
          } finally {
            setBusy(false)
          }
        }}
      >
        <label>
          标题
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          日期
          <input
            required
            type="date"
            min={trip.startDate}
            max={trip.endDate}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          地点
          <input
            maxLength={200}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          />
        </label>
        <Button loading={busy} disabled={expired}>
          保存条目
        </Button>
      </form>
      {kind !== 'create' && (
        <>
          <Button
            variant="outline"
            disabled={expired || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await writeEntity(
                  db,
                  trip.id,
                  'itinerary_item',
                  entityId,
                  'delete',
                )
                await onSaved()
                toast.success('条目已删除', {
                  action: {
                    label: '撤销',
                    onClick: () => {
                      void writeEntity(
                        db,
                        trip.id,
                        'itinerary_item',
                        entityId,
                        'restore',
                      ).catch((error) => toast.error(String(error)))
                    },
                  },
                })
              } catch (error) {
                toast.error(String(error))
              } finally {
                setBusy(false)
              }
            }}
          >
            删除条目
          </Button>
          <Button variant="outline" onClick={() => setHistory(true)}>
            修改记录
          </Button>
          <ResponsiveOverlay
            open={history}
            onOpenChange={setHistory}
            title="条目修改记录"
          >
            <HistoryList db={db} tripId={trip.id} entityId={entityId} />
          </ResponsiveOverlay>
        </>
      )}
    </>
  )
}
export function Itinerary() {
  const { db, tripId } = useTripData()
  const trip = useLiveQuery(() => db.trips.get(tripId), [db, tripId])
  const items = useEntities(db, tripId, 'itinerary_item')
  const pending = useLiveQuery(
    () => db.outbox.where('tripId').equals(tripId).sortBy('localId'),
    [db, tripId],
    [],
  )
  const [editor, setEditor] = useState<{
    id: string
    fields: Op['fields']
    kind: Op['kind']
  } | null>(null)
  const [params] = useSearchParams()
  const [noticesOpen, setNoticesOpen] = useState(() => params.has('notices'))
  const notices = useLiveQuery(
    () => db.notices.where('tripId').equals(tripId).toArray(),
    [db, tripId],
    [],
  )
  const days: string[] = []
  if (trip)
    for (
      let d = new Date(`${trip.startDate}T12:00:00Z`);
      d.toISOString().slice(0, 10) <= trip.endDate;
      d.setUTCDate(d.getUTCDate() + 1)
    )
      days.push(d.toISOString().slice(0, 10))
  const groups = [...days, 'outside']
  return (
    <main className="page stack">
      <h1>行程</h1>
      <Button variant="outline" onClick={() => setNoticesOpen(true)}>
        行程提示（{notices.filter((n) => !n.dismissed).length}）
      </Button>
      {groups.map((day, index) => (
        <section key={day} className="stack">
          <h2>
            {day === 'outside'
              ? '未在行程日期内'
              : `第 ${index + 1} 天 · ${new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))}`}
          </h2>
          {items
            .filter((row) =>
              day === 'outside'
                ? !days.includes(String(row.view!.fields.date))
                : row.view!.fields.date === day,
            )
            .sort(
              (a, b) =>
                (a.view!.createdSeq || Number.MAX_SAFE_INTEGER) -
                  (b.view!.createdSeq || Number.MAX_SAFE_INTEGER) ||
                (pending.find(
                  (op) => op.entityId === a.entityId && op.kind === 'create',
                )?.localId ?? 0) -
                  (pending.find(
                    (op) => op.entityId === b.entityId && op.kind === 'create',
                  )?.localId ?? 0),
            )
            .map((row) => (
              <button
                className="list-row flex flex-col items-start gap-2 text-left"
                data-testid="itinerary-item"
                key={row.entityId}
                onClick={() =>
                  setEditor({
                    id: row.entityId,
                    fields: row.view!.fields,
                    kind: 'update',
                  })
                }
              >
                <strong>{String(row.view!.fields.title)}</strong>
                <span>{String(row.view!.fields.place ?? '')}</span>
              </button>
            ))}
        </section>
      ))}
      <Fab
        aria-label="新增条目"
        disabled={!trip || useSession.getState().status !== 'authenticated'}
        onClick={() =>
          setEditor({ id: crypto.randomUUID(), fields: {}, kind: 'create' })
        }
      />
      <ResponsiveOverlay
        open={!!editor}
        onOpenChange={(open) => {
          if (!open) setEditor(null)
        }}
        title={editor?.kind === 'create' ? '新增条目' : '编辑条目'}
      >
        {editor && trip && (
          <ItemEditor
            key={editor.id}
            db={db}
            trip={trip}
            entityId={editor.id}
            initial={editor.fields}
            kind={editor.kind}
            onSaved={() => setEditor(null)}
          />
        )}
      </ResponsiveOverlay>
      <ResponsiveOverlay
        open={noticesOpen}
        onOpenChange={setNoticesOpen}
        title="行程提示"
      >
        <NoticeList db={db} notices={notices} />
      </ResponsiveOverlay>
    </main>
  )
}
function NoticeList({ db, notices }: { db: Database; notices: Notice[] }) {
  const members = useLiveQuery(
    () => db.entities.filter((row) => row.entity === 'member').toArray(),
    [db],
    [],
  )
  const name = (id?: string) =>
    String(
      members.find((m) => m.entityId === id)?.view?.fields.nickname ??
        id ??
        '其他成员',
    )
  return (
    <div className="stack">
      {notices
        .filter((n) => !n.dismissed)
        .map((n) => (
          <Card key={n.id}>
            <p>
              {n.type === 'deleted'
                ? `该项已被 ${name(n.otherUserId)} 删除`
                : n.type === 'conflict'
                  ? `你对“${labels[n.field!] ?? n.field}”的修改${n.direction === 'overwrote' ? `覆盖了 ${name(n.otherUserId)} 的修改` : `被 ${name(n.otherUserId)} 覆盖`}（${value(n.oldValue)} → ${value(n.newValue)}）`
                  : n.message}
            </p>
            <div className="row">
              {n.type && (
                <Button
                  onClick={async () => {
                    try {
                      await writeEntity(
                        db,
                        n.tripId,
                        n.entity!,
                        n.entityId!,
                        n.type === 'deleted' ? 'restore' : 'update',
                        n.type === 'deleted' ? {} : { [n.field!]: n.oldValue },
                      )
                      await db.notices.update(n.id!, { dismissed: true })
                    } catch (error) {
                      toast.error(String(error))
                    }
                  }}
                >
                  {n.type === 'deleted' ? '恢复该项' : '恢复为旧值'}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() =>
                  void db.notices.update(n.id!, { dismissed: true })
                }
              >
                知道了
              </Button>
            </div>
          </Card>
        ))}
    </div>
  )
}
const rejectionReasons: Record<string, string> = {
  invalid_op: '修改内容不合法，请检查字段格式与长度',
  actor_mismatch: '操作用户与当前账户不一致',
  entity_readonly: '该实体只允许通过在线管理修改',
  entity_exists: '该条目已存在，不能重复创建',
  entity_not_found: '该条目不存在，请修正或丢弃',
}
export function RejectedChanges() {
  const user = useSession((s) => s.currentUser)!
  const db = database(user.id)
  const rows = useLiveQuery(() => db.rejected.toArray(), [db], [])
  const entities = useLiveQuery(() => db.entities.toArray(), [db], [])
  const [retry, setRetry] = useState<Pending | null>(null)
  const trip = useLiveQuery(
    () => (retry ? db.trips.get(retry.tripId) : undefined),
    [db, retry],
  )
  const entity = useLiveQuery(
    () =>
      retry
        ? db.entities.get([retry.tripId, retry.entity, retry.entityId])
        : undefined,
    [db, retry],
  )
  return (
    <div className="stack">
      {rows.map((row) => (
        <Card key={row.opId}>
          <p>
            行程条目「
            {String(
              entities.find(
                (entity) =>
                  entity.tripId === row.tripId &&
                  entity.entityId === row.entityId,
              )?.server?.fields.title ??
                row.fields.title ??
                '未命名',
            )}
            」 ·{' '}
            {
              {
                create: '新增',
                update: '修改',
                delete: '删除',
                restore: '恢复',
              }[row.kind]
            }
          </p>
          {Object.entries(row.fields).map(([key, v]) => (
            <p key={key}>
              {labels[key] ?? key}：{value(v)}
            </p>
          ))}
          <p role="alert">
            {rejectionReasons[row.error.code] ?? '修改暂未生效'}（
            {row.error.message}）
          </p>
          <div className="row">
            <Button onClick={() => setRetry(row)}>修改后重试</Button>
            <Button
              variant="outline"
              onClick={() => void db.rejected.delete(row.opId)}
            >
              丢弃
            </Button>
          </div>
        </Card>
      ))}
      <ResponsiveOverlay
        open={!!retry}
        onOpenChange={(open) => {
          if (!open) setRetry(null)
        }}
        title="修改后重试"
      >
        {retry &&
          trip &&
          (retry.kind === 'update' || retry.kind === 'create' ? (
            <ItemEditor
              key={retry.opId}
              db={db}
              trip={trip}
              entityId={retry.entityId}
              kind={retry.kind}
              initial={{ ...entity?.server?.fields, ...retry.fields }}
              baseline={entity?.server?.fields ?? {}}
              onSaved={async () => {
                await db.rejected.delete(retry.opId)
                setRetry(null)
              }}
            />
          ) : (
            <Button
              onClick={async () => {
                await writeEntity(
                  db,
                  retry.tripId,
                  retry.entity,
                  retry.entityId,
                  retry.kind,
                )
                await db.rejected.delete(retry.opId)
                setRetry(null)
              }}
            >
              重试{retry.kind === 'delete' ? '删除' : '恢复'}
            </Button>
          ))}
      </ResponsiveOverlay>
    </div>
  )
}
export function HistoryList({
  db,
  tripId,
  entityId,
}: {
  db: Database
  tripId: string
  entityId?: string
}) {
  const [limit, setLimit] = useState(30)
  const [busy, setBusy] = useState(false)
  const [end, setEnd] = useState(false)
  const online = useOnline()
  const rows = useLiveQuery(
    async () =>
      (await db.ops.where('tripId').equals(tripId).toArray())
        .filter((op) => !entityId || op.entityId === entityId)
        .sort((a, b) => b.serverSeq - a.serverSeq),
    [db, tripId, entityId],
    [],
  )
  const members = useEntities(db, tripId, 'member')
  const name = (id: string) =>
    String(members.find((m) => m.entityId === id)?.view?.fields.nickname ?? id)
  return (
    <div className="stack">
      {rows.slice(0, limit).map((op) => (
        <Card key={op.serverSeq}>
          <p>
            {name(op.actorUserId)} · {new Date(op.serverTime).toLocaleString()}{' '}
            {op.conflicts?.length ? '冲突' : ''}
          </p>
          <p>
            {op.entity === 'member'
              ? op.kind === 'create' || op.kind === 'restore'
                ? `${name(op.entityId)} 加入了行程`
                : op.fields.leftAt
                  ? `${name(op.entityId)} 退出了行程`
                  : `${name(op.actorUserId)} 修改了 ${name(op.entityId)} 的成员资料`
              : op.entity === 'trip' && op.fields.name
                ? `${name(op.actorUserId)} 把行程名改为 ${value(op.fields.name)}`
                : op.entity === 'trip'
                  ? `${name(op.actorUserId)} 修改了行程设置`
                  : `行程条目 · ${{ create: '新增', update: '修改', delete: '删除', restore: '恢复' }[op.kind]}`}
          </p>
          {Object.entries(op.changes).map(([field, change]) => (
            <p key={field}>
              {labels[field] ?? field}：{value(change.old)} →{' '}
              {value(change.new)}
            </p>
          ))}
        </Card>
      ))}
      {rows.length > limit ? (
        <Button onClick={() => setLimit(limit + 30)}>显示更多记录</Button>
      ) : (
        <Button
          disabled={!online || end}
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const { data } = await api.GET('/api/trips/{tripId}/history', {
                params: {
                  path: { tripId },
                  query: {
                    before: rows.at(-1)?.serverSeq,
                    limit: 30,
                    ...(entityId ? { entity: 'itinerary_item', entityId } : {}),
                  },
                },
              })
              if (data) {
                await db.ops.bulkPut(data.ops)
                setLimit(limit + 30)
                setEnd(data.ops.length < 30)
              }
            } catch (error) {
              toast.error(String(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          加载更早记录
        </Button>
      )}
    </div>
  )
}
export function TripHistory() {
  const { db, tripId } = useTripData()
  return (
    <main className="page stack">
      <h1>修改记录</h1>
      <HistoryList db={db} tripId={tripId} />
    </main>
  )
}
