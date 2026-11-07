import { LoadingList } from '@/ui/loading-list'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { useDraggable } from '@dnd-kit/core'
import {
  database,
  writeEntity,
  type Database,
  type Entity,
  type Trip,
  type Pending,
} from '@/data/db'
import { useEntities } from '@/data/hooks'
import { useSession } from '@/platform/session'
import { dayLabel, tripDays } from '@/domain/format'
import { scheduledItems } from '@/domain/itinerary'
import { ResponsiveOverlay } from '@/ui/responsive-overlay'
import { Button } from '@/ui/components/button'
import { toast } from '@/ui/toast'
import { HistoryList } from './itinerary'
import { ExternalLink, GripVertical } from 'lucide-react'
import { ActionMenu } from '@/ui/action-menu'
import { ListCard } from '@/ui/list-card'

import { scheduleWish } from './schedule-wish'
export function DateChooser({
  trip,
  onChoose,
}: {
  trip: Trip
  onChoose: (date: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="stack">
      {tripDays(trip.startDate, trip.endDate).map((date, i) => (
        <Button
          key={date}
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onChoose(date)
            } catch (e) {
              toast.error(String(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          {dayLabel(date, i)}
        </Button>
      ))}
    </div>
  )
}
function WishCard({
  wish,
  trip,
  db,
  items,
  onEdit,
  onSchedule,
  draggable,
}: {
  wish: Entity
  trip: Trip
  db: Database
  items: Entity[]
  onEdit: () => void
  onSchedule: () => void
  draggable: boolean
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `wish:${wish.entityId}`,
    data: { wish },
    disabled: !draggable,
  })
  const scheduled = scheduledItems(
    wish.entityId,
    items.flatMap((i) => (i.view ? [i.view] : [])),
  )
  const days = tripDays(trip.startDate, trip.endDate)
  const f = wish.view!.fields
  return (
    <article
      className="wish-card"
      ref={setNodeRef}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px,${transform.y}px,0)`
          : undefined,
      }}
    >
      <ListCard
        status={
          scheduled.length ? (
            <Link
              to={`/trips/${trip.id}?item=${scheduled[0].entityId}#item-${scheduled[0].entityId}`}
            >
              {days.includes(String(scheduled[0].fields.date))
                ? `第 ${days.indexOf(String(scheduled[0].fields.date)) + 1} 天`
                : String(scheduled[0].fields.date)}
            </Link>
          ) : (
            '未安排'
          )
        }
        title={
          <span className="row">
            <strong>{String(f.title)}</strong>
            {!!f.url && (
              <a
                aria-label="查看链接"
                href={String(f.url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={16} />
              </a>
            )}
          </span>
        }
        secondary={f.place ? String(f.place) : undefined}
        description={f.note ? String(f.note) : undefined}
        menu={
          <ActionMenu
            label={`心愿操作 ${f.title}`}
            actions={[
              { label: '编辑心愿', onSelect: onEdit },
              {
                label: '删除心愿',
                danger: true,
                onSelect: async () => {
                  await writeEntity(
                    db,
                    trip.id,
                    'wish_item',
                    wish.entityId,
                    'delete',
                  )
                  toast.undoable('心愿已删除', () => {
                    void writeEntity(
                      db,
                      trip.id,
                      'wish_item',
                      wish.entityId,
                      'restore',
                    ).catch((e) => toast.error(String(e)))
                  })
                },
              },
            ]}
          />
        }
      >
        {draggable && (
          <Button
            variant="ghost"
            aria-label={`拖动心愿 ${f.title}`}
            {...attributes}
            {...listeners}
            className="drag-handle"
          >
            <GripVertical size={18} />
          </Button>
        )}
        {scheduled.length > 1 && <p>已安排 {scheduled.length} 次</p>}
        <div className="row">
          <Button onClick={onSchedule}>安排到…</Button>
        </div>
      </ListCard>
    </article>
  )
}
export function WishEditor({
  db,
  trip,
  wish,
  onSaved,
  retry,
}: {
  db: Database
  trip: Trip
  wish: Entity | null
  onSaved: () => void | Promise<void>
  retry?: Pending
}) {
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      ['title', 'place', 'note', 'url'].map((k) => [
        k,
        String(
          retry && k in retry.fields
            ? (retry.fields[k] ?? '')
            : (wish?.view?.fields[k] ?? ''),
        ),
      ]),
    ),
  )
  const [busy, setBusy] = useState(false),
    [history, setHistory] = useState(false)
  return (
    <>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            const all = Object.fromEntries(
              Object.entries(fields).map(([k, v]) => [k, v || null]),
            )
            const changed =
              wish?.view && retry?.kind !== 'create'
                ? Object.fromEntries(
                    Object.entries(all).filter(
                      ([k, v]) => v !== (wish.view!.fields[k] ?? null),
                    ),
                  )
                : all
            await writeEntity(
              db,
              trip.id,
              'wish_item',
              retry?.entityId ?? wish?.entityId ?? crypto.randomUUID(),
              retry?.kind ?? (wish ? 'update' : 'create'),
              changed,
            )
            await onSaved()
          } catch (e) {
            toast.error(String(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        {(['title', 'place', 'note', 'url'] as const).map((k) => (
          <label key={k}>
            {{ title: '标题', place: '地点', note: '备注', url: '链接' }[k]}
            {k === 'note' ? (
              <textarea
                maxLength={2000}
                value={fields[k]}
                onChange={(e) => setFields({ ...fields, [k]: e.target.value })}
              />
            ) : (
              <input
                required={k === 'title'}
                type={k === 'url' ? 'url' : 'text'}
                maxLength={k === 'url' ? 2000 : 200}
                value={fields[k]}
                onChange={(e) => setFields({ ...fields, [k]: e.target.value })}
              />
            )}
          </label>
        ))}
        <Button loading={busy}>保存心愿</Button>
      </form>
      {wish && (
        <Button variant="outline" onClick={() => setHistory(true)}>
          修改记录
        </Button>
      )}
      <ResponsiveOverlay
        open={history}
        onOpenChange={setHistory}
        title="心愿修改记录"
      >
        {wish && (
          <HistoryList
            db={db}
            tripId={trip.id}
            entityId={wish.entityId}
            entity="wish_item"
          />
        )}
      </ResponsiveOverlay>
    </>
  )
}
export function WishlistPanel({
  db,
  trip,
  draggable = false,
}: {
  db: Database
  trip: Trip
  draggable?: boolean
}) {
  const wishes = useEntities(db, trip.id, 'wish_item'),
    items = useEntities(db, trip.id, 'itinerary_item')
  const [editor, setEditor] = useState<Entity | null | undefined>(undefined),
    [schedule, setSchedule] = useState<Entity | null>(null)
  const states = items.flatMap((i) => (i.view ? [i.view] : []))
  if (wishes.loading || items.loading) return <LoadingList />
  const sorted = [...wishes].sort(
    (a, b) =>
      Number(scheduledItems(a.entityId, states).length > 0) -
        Number(scheduledItems(b.entityId, states).length > 0) ||
      a.view!.createdSeq - b.view!.createdSeq,
  )
  return (
    <div className="stack">
      <div className="row">
        <h2>心愿池</h2>
        <Button onClick={() => setEditor(null)}>新增心愿</Button>
      </div>
      {!wishes.length && (
        <p className="text-muted-foreground">
          把想去的地方放进心愿池，再安排到行程。
        </p>
      )}
      {sorted.map((wish) => (
        <WishCard
          key={wish.entityId}
          wish={wish}
          trip={trip}
          db={db}
          items={items}
          onEdit={() => setEditor(wish)}
          onSchedule={() => setSchedule(wish)}
          draggable={draggable}
        />
      ))}
      <ResponsiveOverlay
        open={editor !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditor(undefined)
        }}
        title={editor ? '编辑心愿' : '新增心愿'}
      >
        {editor !== undefined && (
          <WishEditor
            key={editor?.entityId ?? 'new'}
            db={db}
            trip={trip}
            wish={editor}
            onSaved={() => setEditor(undefined)}
          />
        )}
      </ResponsiveOverlay>
      <ResponsiveOverlay
        open={!!schedule}
        onOpenChange={(open) => {
          if (!open) setSchedule(null)
        }}
        title="安排到…"
      >
        <DateChooser
          trip={trip}
          onChoose={async (date) => {
            await scheduleWish(db, trip, schedule!, date)
            setSchedule(null)
          }}
        />
      </ResponsiveOverlay>
    </div>
  )
}
export function Wishlist() {
  const { tripId = '' } = useParams(),
    user = useSession((s) => s.currentUser)!,
    db = database(user.id)
  const trip = useLiveQuery(() => db.trips.get(tripId), [db, tripId])
  return (
    <main className="page stack">
      <Link to={`/trips/${tripId}`}>返回行程</Link>
      {trip && <WishlistPanel db={db} trip={trip} />}
    </main>
  )
}
