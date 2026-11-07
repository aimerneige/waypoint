import { LoadingList } from '@/ui/loading-list'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Bell, GripVertical } from 'lucide-react'
import { ActionMenu } from '@/ui/action-menu'
import { ListCard } from '@/ui/list-card'
import { LedgerRetry } from './ledger'
import { PackingPollsRetry } from './packing-polls-retry'
import { VoucherSelect, VoucherRetry } from './vouchers'
import { VoucherLinks } from './voucher-viewer'
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  database,
  writeEntity,
  type Database,
  type Pending,
  type Notice,
  type Trip,
  type Entity,
} from '@/data/db'
import { useEntities } from '@/data/hooks'
import { useSession } from '@/platform/session'
import { api } from '@/api/client'
import { useMedia, useOnline } from '@/ui/hooks'
import { DateInput } from '@/ui/date-input'
import {
  dayLabel,
  formatDateTime,
  todayInZone,
  tripDays,
  validTimezone,
} from '@/domain/format'
import {
  compareItems,
  insertionKey,
  scheduledItems,
  sortKey,
  timeLabel,
} from '@/domain/itinerary'
import { DateChooser, WishEditor, WishlistPanel } from './wishlist'
import { scheduleWish } from './schedule-wish'
import { ResponsiveOverlay } from '@/ui/responsive-overlay'
import { Button } from '@/ui/components/button'
import { Card } from '@/ui/components/card'
import { toast } from '@/ui/toast'
import { Fab } from '@/ui/shell'
import type { Op } from '@/domain/ops'
import { formatMoney } from '@/domain/money'

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
  startTime: '开始时间',
  endTime: '结束时间',
  endTimezone: '到达时区',
  bookingInfo: '预订信息',
  voucherIds: '凭证',
  wishItemId: '心愿',
  sortOrder: '排序',
  note: '备注',
  url: '链接',
  ownerUserId: '钱包主人',
  currency: '币种',
  cnyPaid: '支付人民币',
  foreignReceived: '收到外币',
  time: '时间',
  category: '分类',
  amount: '原币金额',
  method: '支付方式',
  cardNote: '卡片备注',
  payerUserId: '付款人',
  rateSource: '汇率来源',
  rate: '汇率',
  amountCny: '人民币金额',
  split: '分摊',
  fromUserId: '转出成员',
  toUserId: '收款成员',
  scope: '物品类型',
  assigneeUserId: '负责人',
  packed: '已装',
  packedBy: '装箱人',
  question: '问题',
  multiChoice: '允许多选',
  deadline: '截止时间',
  closedAt: '关闭时间',
  pollId: '所属投票',
  text: '选项内容',
  type: '凭证类型',
  fileId: '文件',
  mime: '文件格式',
  size: '文件大小',
  visibility: '可见性',
}
const entityLabels: Record<string, string> = {
  voucher: '凭证',
  packing_item: '行李物品',
  poll: '投票',
  poll_option: '投票选项',
  expense: '账目',
  exchange: '换汇',
  settlement_transfer: '结算转账',
  trip_rates: '默认汇率',
  wish_item: '心愿',
  itinerary_item: '行程条目',
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
  const [extra, setExtra] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      [
        'startTime',
        'endTime',
        'timezone',
        'endDate',
        'endTimezone',
        'bookingInfo',
      ].map((k) => [k, String(initial[k] ?? '')]),
    ),
  )
  const [busy, setBusy] = useState(false)
  const [voucherIds, setVoucherIds] = useState<string[]>(
    (initial.voucherIds as string[] | undefined) ?? [],
  )
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
            for (const key of ['timezone', 'endTimezone']) {
              if (extra[key] && !validTimezone(extra[key]))
                throw new Error(`${labels[key]}无效，请输入 IANA 时区`)
            }
            const peers =
              kind === 'create'
                ? (
                    await db.entities
                      .where('[tripId+entity]')
                      .equals([trip.id, 'itinerary_item'])
                      .toArray()
                  )
                    .flatMap((r) =>
                      r.view &&
                      !r.view.deleted &&
                      r.view.fields.date === date &&
                      !r.view.fields.startTime
                        ? [r.view]
                        : [],
                    )
                    .sort(compareItems)
                : []
            const all = {
              title,
              date,
              place: place || null,
              ...(voucherIds.length || initial.voucherIds
                ? { voucherIds }
                : {}),
              ...Object.fromEntries(
                Object.entries(extra).map(([k, v]) => [k, v || null]),
              ),
              ...(kind === 'create'
                ? {
                    sortOrder: insertionKey(
                      peers.length ? sortKey(peers.at(-1)!) : null,
                    ),
                  }
                : {}),
            }
            const fields =
              kind === 'create'
                ? all
                : Object.fromEntries(
                    Object.entries(all).filter(
                      ([key, v]) =>
                        JSON.stringify(v) !==
                        JSON.stringify(baseline[key] ?? null),
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
          <DateInput value={date} onChange={setDate} />
        </label>
        {(['startTime', 'endTime'] as const).map((k) => (
          <label key={k}>
            {labels[k]}
            <input
              type="time"
              value={extra[k]}
              onChange={(e) => setExtra({ ...extra, [k]: e.target.value })}
            />
          </label>
        ))}
        <details>
          <summary>更多选项</summary>
          <div className="stack">
            <label>
              时区
              <input
                placeholder={trip.timezone}
                value={extra.timezone}
                onChange={(e) =>
                  setExtra({ ...extra, timezone: e.target.value })
                }
              />
            </label>
            <label>
              到达日期
              <input
                type="date"
                min={date}
                value={extra.endDate}
                onChange={(e) =>
                  setExtra({ ...extra, endDate: e.target.value })
                }
              />
            </label>
            <label>
              到达时区
              <input
                placeholder={extra.timezone || trip.timezone}
                value={extra.endTimezone}
                onChange={(e) =>
                  setExtra({ ...extra, endTimezone: e.target.value })
                }
              />
            </label>
          </div>
        </details>
        <label>
          地点
          <input
            maxLength={200}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          />
        </label>
        <label>
          预订信息
          <textarea
            maxLength={2000}
            value={extra.bookingInfo}
            onChange={(e) =>
              setExtra({ ...extra, bookingInfo: e.target.value })
            }
          />
        </label>
        <VoucherSelect
          db={db}
          tripId={trip.id}
          selected={voucherIds}
          onChange={setVoucherIds}
        />
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
  const [noticesOpen, setNoticesOpen] = useState(false)
  useEffect(() => {
    if (!params.has('notices')) return
    // 等路由清理旧弹层记录后再打开，避免新面板被同一次导航关闭。
    const timer = window.setTimeout(() => setNoticesOpen(true), 0)
    return () => window.clearTimeout(timer)
  }, [params])
  const notices = useLiveQuery(
    () => db.notices.where('tripId').equals(tripId).toArray(),
    [db, tripId],
    [],
  )
  const wishes = useEntities(db, tripId, 'wish_item')
  const desktop = useMedia('(min-width: 840px)')
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
  )
  const [moving, setMoving] = useState<Entity | null>(null)
  const [visibleCount, setVisibleCount] = useState(50)
  const days = trip ? tripDays(trip.startDate, trip.endDate) : []
  const today = trip ? todayInZone(trip.timezone) : ''
  const scrolled = useRef('')
  useEffect(() => {
    if (trip) {
      const target = params.get('item')
      const key = `${trip.id}:${target ?? today}`
      const element = document.getElementById(
        target ? `item-${target}` : `day-${today}`,
      )
      if (element && scrolled.current !== key) {
        element.scrollIntoView({ block: 'center' })
        scrolled.current = key
      }
    }
  }, [trip, today, params, items])
  const sorted = (day: string) =>
    items
      .filter((row) =>
        day === 'outside'
          ? !days.includes(String(row.view!.fields.date))
          : row.view!.fields.date === day,
      )
      .sort(
        (a, b) =>
          compareItems(a.view!, b.view!) ||
          (pending.find((o) => o.entityId === a.entityId && o.kind === 'create')
            ?.localId ?? 0) -
            (pending.find(
              (o) => o.entityId === b.entityId && o.kind === 'create',
            )?.localId ?? 0),
      )
  async function move(row: Entity, date: string, target?: Entity) {
    const peers = sorted(date).filter(
      (i) => i.entityId !== row.entityId && !i.view!.fields.startTime,
    )
    const index = target
      ? peers.findIndex((i) => i.entityId === target.entityId)
      : peers.length
    const sameDay = row.view!.fields.date === date
    const original = sorted(date)
    const movingDown =
      target && sameDay && original.indexOf(row) < original.indexOf(target)
    const at = index < 0 ? peers.length : index + (movingDown ? 1 : 0)
    const before = peers[at - 1]?.view ? sortKey(peers[at - 1].view!) : null,
      after = peers[at]?.view ? sortKey(peers[at].view!) : null
    const key = after
      ? insertionKey(before ? String(before) : null, String(after))
      : insertionKey(before ? String(before) : null)
    await writeEntity(db, tripId, 'itinerary_item', row.entityId, 'update', {
      date,
      ...shiftArrival(row.view!.fields, date),
      ...(!row.view!.fields.startTime ? { sortOrder: key } : {}),
    })
  }
  async function reorder(row: Entity, direction: number) {
    const peers = sorted(String(row.view!.fields.date)).filter(
        (i) => !i.view!.fields.startTime,
      ),
      index = peers.findIndex((i) => i.entityId === row.entityId),
      target = index + direction
    if (target < 0 || target >= peers.length) return
    const remaining = peers.filter((i) => i !== row)
    const before = remaining[target - 1]?.view
        ? sortKey(remaining[target - 1].view!)
        : null,
      after = remaining[target]?.view ? sortKey(remaining[target].view!) : null
    const key = after
      ? insertionKey(before ? String(before) : null, String(after))
      : insertionKey(before ? String(before) : null)
    await writeEntity(db, tripId, 'itinerary_item', row.entityId, 'update', {
      sortOrder: key,
    })
  }
  async function dragEnd(event: DragEndEvent) {
    if (!trip || !event.over) return
    try {
      const over = String(event.over.id),
        target = items.find((i) => i.entityId === over)
      const date = over.startsWith('day:')
        ? over.slice(4)
        : String(target?.view!.fields.date ?? '')
      if (!days.includes(date)) return
      const wish = event.active.data.current?.wish as Entity | undefined
      if (wish) await scheduleWish(db, trip, wish, date)
      else {
        const row = items.find((i) => i.entityId === String(event.active.id))
        if (row && row !== target) await move(row, date, target)
      }
    } catch (e) {
      toast.error(String(e))
    }
  }
  const groups = [...days, 'outside']
  if (items.loading || wishes.loading)
    return (
      <main className="page">
        <LoadingList />
      </main>
    )
  return (
    <main className="page stack">
      <div className="row justify-between">
        <h1>行程</h1>
        <Button
          variant="outline"
          aria-label="行程提示"
          onClick={() => setNoticesOpen(true)}
        >
          <Bell size={20} />
          {notices.filter((n) => !n.dismissed).length > 0 && (
            <span className="notice-count">
              {notices.filter((n) => !n.dismissed).length}
            </span>
          )}
        </Button>
      </div>
      <Button variant="outline" asChild>
        <Link to={`/trips/${tripId}/wishes`}>
          心愿池（
          {
            wishes.filter(
              (w) =>
                !scheduledItems(
                  w.entityId,
                  items.map((i) => i.view!),
                ).length,
            ).length
          }{' '}
          未安排）
        </Link>
      </Button>
      <DndContext sensors={sensors} onDragEnd={dragEnd}>
        <div className="itinerary-columns">
          <div className="stack">
            {groups.map((day, index) => (
              <DaySection
                key={day}
                day={day}
                title={
                  day === 'outside' ? '未在行程日期内' : dayLabel(day, index)
                }
                today={day === today}
              >
                <SortableContext items={sorted(day).map((i) => i.entityId)}>
                  {trip &&
                    sorted(day)
                      .map((row, i, rows) => (
                        <ItineraryCard
                          key={row.entityId}
                          row={row}
                          trip={trip!}
                          desktop={desktop}
                          onEdit={() =>
                            setEditor({
                              id: row.entityId,
                              fields: row.view!.fields,
                              kind: 'update',
                            })
                          }
                          onMove={() => setMoving(row)}
                          onReorder={(direction) => {
                            void reorder(row, direction).catch((e) =>
                              toast.error(String(e)),
                            )
                          }}
                          canUp={i > 0}
                          canDown={
                            i <
                            rows.filter((r) => !r.view!.fields.startTime)
                              .length -
                              1
                          }
                          onReturn={async () => {
                            try {
                              await writeEntity(
                                db,
                                tripId,
                                'itinerary_item',
                                row.entityId,
                                'delete',
                              )
                              toast.undoable('已移回心愿池', () => {
                                void writeEntity(
                                  db,
                                  tripId,
                                  'itinerary_item',
                                  row.entityId,
                                  'restore',
                                ).catch((e) => toast.error(String(e)))
                              })
                            } catch (e) {
                              toast.error(String(e))
                            }
                          }}
                        />
                      ))
                      .filter(
                        (row, i) =>
                          i < visibleCount || row.key === params.get('item'),
                      )}
                </SortableContext>
                {sorted(day).length > visibleCount && (
                  <Button
                    variant="outline"
                    onClick={() => setVisibleCount(visibleCount + 50)}
                  >
                    显示更多行程（{visibleCount}/{sorted(day).length}）
                  </Button>
                )}
                {!sorted(day).length && day !== 'outside' && (
                  <p className="text-muted-foreground">这一天还没有安排</p>
                )}
              </DaySection>
            ))}
          </div>
          {desktop && trip && (
            <aside className="stack">
              <WishlistPanel db={db} trip={trip} draggable />
            </aside>
          )}
        </div>
      </DndContext>
      <ResponsiveOverlay
        open={!!moving}
        onOpenChange={(open) => {
          if (!open) setMoving(null)
        }}
        title="移到其它天"
      >
        {trip && moving && (
          <DateChooser
            trip={trip}
            onChoose={async (date) => {
              await move(moving, date)
              setMoving(null)
            }}
          />
        )}
      </ResponsiveOverlay>
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
function shiftArrival(fields: Op['fields'], date: string) {
  if (!fields.endDate || fields.date === date) return {}
  const delta =
    new Date(`${date}T12:00:00Z`).getTime() -
    new Date(`${fields.date}T12:00:00Z`).getTime()
  return {
    endDate: new Date(new Date(`${fields.endDate}T12:00:00Z`).getTime() + delta)
      .toISOString()
      .slice(0, 10),
  }
}
function DaySection({
  day,
  title,
  today,
  children,
}: {
  day: string
  title: string
  today: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day:${day}`,
    disabled: day === 'outside',
  })
  return (
    <section
      ref={setNodeRef}
      id={`day-${day}`}
      data-day={day}
      className={`day-section stack ${today ? 'is-today' : ''} ${isOver ? 'drop-active' : ''}`}
    >
      <h2>
        {title}
        {today ? ' · 今天' : ''}
      </h2>
      {children}
    </section>
  )
}
function BookingText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>]+|\+?\d[\d ()-]{5,}\d)/g)
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        ) : /^\+?\d[\d ()-]{5,}\d$/.test(part) ? (
          <a key={i} href={`tel:${part.replace(/[^+\d]/g, '')}`}>
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  )
}
function ItineraryCard({
  row,
  trip,
  desktop,
  onEdit,
  onMove,
  onReorder,
  canUp,
  canDown,
  onReturn,
}: {
  row: Entity
  trip: Trip
  desktop: boolean
  onEdit: () => void
  onMove: () => void
  onReorder: (direction: number) => void
  canUp: boolean
  canDown: boolean
  onReturn: () => Promise<void>
}) {
  const f = row.view!.fields
  const { db, tripId } = useTripData()
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: row.entityId, disabled: !desktop })
  return (
    <article
      id={`item-${row.entityId}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="itinerary-card"
    >
      <ListCard
        title={
          <button
            className="item-main"
            data-testid="itinerary-item"
            onClick={onEdit}
          >
            <strong>{String(f.title)}</strong>
            <span className="item-time">{timeLabel(f, trip.timezone)}</span>
          </button>
        }
        secondary={[f.place, f.wishItemId ? '来自心愿' : null]
          .filter(Boolean)
          .join(' · ')}
        description={
          f.bookingInfo ? (
            <BookingText text={String(f.bookingInfo).split('\n')[0]} />
          ) : undefined
        }
        menu={
          <ActionMenu
            label={`条目操作 ${f.title}`}
            actions={[
              ...(!f.startTime
                ? [
                    {
                      label: '上移',
                      disabled: !canUp,
                      onSelect: () => onReorder(-1),
                    },
                    {
                      label: '下移',
                      disabled: !canDown,
                      onSelect: () => onReorder(1),
                    },
                  ]
                : []),
              { label: '移到其它天', onSelect: onMove },
              ...(f.wishItemId
                ? [{ label: '移回心愿池', onSelect: onReturn }]
                : []),
              {
                label: '删除条目',
                danger: true,
                onSelect: async () => {
                  await writeEntity(
                    db,
                    tripId,
                    'itinerary_item',
                    row.entityId,
                    'delete',
                  )
                  toast.undoable('条目已删除', () => {
                    void writeEntity(
                      db,
                      tripId,
                      'itinerary_item',
                      row.entityId,
                      'restore',
                    ).catch((e) => toast.error(String(e)))
                  })
                },
              },
            ]}
          />
        }
      />
      <VoucherLinks
        db={db}
        tripId={tripId}
        ids={(f.voucherIds as string[] | undefined) ?? []}
      />
      {desktop && (
        <Button
          variant="ghost"
          className="drag-handle"
          aria-label={`拖动条目 ${f.title}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={18} />
        </Button>
      )}
    </article>
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
      {!notices.some((n) => !n.dismissed) && (
        <p className="muted">
          暂无提示，修改冲突或条目删除后会在这里说明。关闭面板继续安排行程。
        </p>
      )}
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
  poll_closed: '投票已截止',
  forbidden_field: '没有权限修改此字段',
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
            {entityLabels[row.entity] ?? row.entity}「
            {String(
              entities.find(
                (entity) =>
                  entity.tripId === row.tripId &&
                  entity.entityId === row.entityId,
              )?.server?.fields.title ??
                entities.find(
                  (entity) =>
                    entity.tripId === row.tripId &&
                    entity.entityId === row.entityId,
                )?.server?.fields.question ??
                entities.find(
                  (entity) =>
                    entity.tripId === row.tripId &&
                    entity.entityId === row.entityId,
                )?.server?.fields.name ??
                entities.find(
                  (entity) =>
                    entity.tripId === row.tripId &&
                    entity.entityId === row.entityId,
                )?.server?.fields.text ??
                row.fields.title ??
                row.fields.question ??
                row.fields.name ??
                row.fields.text ??
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
              {key.startsWith('vote.')
                ? '我的投票'
                : key.startsWith('checked.')
                  ? '我的勾选'
                  : key === 'name' && row.entity === 'packing_item'
                    ? '物品名称'
                    : (labels[key] ?? key)}
              ：
              {key.startsWith('vote.') && Array.isArray(v)
                ? v
                    .map((id) =>
                      String(
                        entities.find(
                          (entity) =>
                            entity.tripId === row.tripId &&
                            entity.entityId === id,
                        )?.view?.fields.text ?? '已删除选项',
                      ),
                    )
                    .join('、') || '撤票'
                : typeof v === 'boolean'
                  ? v
                    ? '是'
                    : '否'
                  : value(v)}
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
          (['packing_item', 'poll', 'poll_option'].includes(retry.entity) &&
          (retry.kind === 'update' || retry.kind === 'create') ? (
            <PackingPollsRetry
              key={retry.opId}
              db={db}
              retry={retry}
              done={async () => {
                await db.rejected.delete(retry.opId)
                setRetry(null)
              }}
            />
          ) : retry.entity === 'wish_item' &&
            (retry.kind === 'update' || retry.kind === 'create') ? (
            <WishEditor
              db={db}
              trip={trip}
              wish={entity ?? null}
              retry={retry}
              onSaved={async () => {
                await db.rejected.delete(retry.opId)
                setRetry(null)
              }}
            />
          ) : [
              'expense',
              'exchange',
              'trip_rates',
              'settlement_transfer',
            ].includes(retry.entity) &&
            (retry.kind === 'update' || retry.kind === 'create') ? (
            <LedgerRetry
              key={retry.opId}
              db={db}
              trip={trip}
              retry={retry}
              entity={entity}
              onSaved={async () => {
                await db.rejected.delete(retry.opId)
                setRetry(null)
              }}
            />
          ) : retry.entity === 'voucher' &&
            (retry.kind === 'update' || retry.kind === 'create') ? (
            <VoucherRetry
              db={db}
              retry={retry}
              done={async () => {
                setRetry(null)
              }}
            />
          ) : retry.kind === 'update' || retry.kind === 'create' ? (
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
  entity = 'itinerary_item',
}: {
  db: Database
  tripId: string
  entityId?: string
  entity?: string
}) {
  const [limit, setLimit] = useState(30)
  const [busy, setBusy] = useState(false)
  const [end, setEnd] = useState(false)
  const online = useOnline()
  const loadedRows = useLiveQuery(
    async () =>
      (await db.ops.where('tripId').equals(tripId).toArray())
        .filter(
          (op) =>
            !entityId || (op.entityId === entityId && op.entity === entity),
        )
        .sort((a, b) => b.serverSeq - a.serverSeq),
    [db, tripId, entityId, entity],
  )
  const rows = loadedRows ?? []
  const members = useEntities(db, tripId, 'member')
  const states = useLiveQuery(
    () => db.entities.where('tripId').equals(tripId).toArray(),
    [db, tripId],
    [],
  )
  const historyValue = (
    op: import('@/domain/ops').ServerOp,
    field: string,
    v: unknown,
  ) => {
    if (v == null) return '空'
    if (
      ['amount', 'cnyPaid', 'foreignReceived', 'amountCny'].includes(field) &&
      typeof v === 'number'
    ) {
      const currency =
        field === 'amount' || field === 'foreignReceived'
          ? String(
              op.fields.currency ??
                states.find(
                  (s) => s.entity === op.entity && s.entityId === op.entityId,
                )?.view?.fields.currency ??
                'CNY',
            )
          : 'CNY'
      return formatMoney(BigInt(v), currency)
    }
    if (field === 'split' && typeof v === 'object') return JSON.stringify(v)
    return value(v)
  }
  const name = (id: string) =>
    String(members.find((m) => m.entityId === id)?.view?.fields.nickname ?? id)
  if (!loadedRows) return <LoadingList />
  return (
    <div className="stack">
      {!rows.length && (
        <p className="muted">
          暂无本地修改记录，可加载更早记录；新增或修改行程后也会显示在这里。
        </p>
      )}
      {rows.slice(0, limit).map((op) => (
        <Card key={op.serverSeq}>
          <p>
            {name(op.actorUserId)} · {formatDateTime(op.serverTime)}{' '}
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
                  : `${entityLabels[op.entity] ?? op.entity} · ${{ create: '新增', update: '修改', delete: '删除', restore: '恢复' }[op.kind]}`}
          </p>
          {Object.entries(op.changes).map(([field, change]) => (
            <p key={field}>
              {field === 'sortOrder'
                ? '调整了顺序'
                : field.startsWith('checked.')
                  ? `${name(field.slice(8))} ${change.new ? '勾选了' : '取消勾选'} ${String(states.find((s) => s.entityId === op.entityId)?.view?.fields.name ?? '物品')}`
                  : field.startsWith('vote.')
                    ? `${name(field.slice(5))} ${Array.isArray(change.new) && change.new.length ? `投给了 ${change.new.map((id) => String(states.find((s) => s.entityId === id)?.view?.fields.text ?? '已删除选项')).join('、')}` : '撤回了投票'}`
                    : `${field === 'name' && op.entity === 'packing_item' ? '物品名称' : field === 'ownerUserId' && op.entity === 'packing_item' ? '仅此成员需要带' : field === 'endDate' && op.entity === 'itinerary_item' ? '到达日期' : (labels[field] ?? field)}：${historyValue(op, field, change.old)} → ${historyValue(op, field, change.new)}`}
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
                    ...(entityId ? { entity, entityId } : {}),
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
      <Link to={`/trips/${tripId}/more`}>← 返回更多</Link>
      <h1>修改记录</h1>
      <HistoryList db={db} tripId={tripId} />
    </main>
  )
}
