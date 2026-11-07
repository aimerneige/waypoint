import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  database,
  writeEntity,
  type Database,
  type Entity,
  type Trip,
} from '@/data/db'
import { useEntities } from '@/data/hooks'
import { useSession } from '@/platform/session'
import { api } from '@/api/client'
import type { components } from '@/api/schema'
import { packingPresets } from '@/domain/packing-presets'
import {
  comparePackingItems,
  personalItems,
  type TemplateSelection,
} from '@/domain/packing'
import { applyPackingTemplate } from '@/data/packing'
import { ActionMenu } from '@/ui/action-menu'
import { ListCard } from '@/ui/list-card'
import { ResponsiveOverlay } from '@/ui/responsive-overlay'
import { Fab } from '@/ui/shell'
import { Button } from '@/ui/components/button'
import { Avatar } from '@/ui/components/avatar'
import { toast } from '@/ui/components/sonner'
import { useOnline } from '@/ui/hooks'
import { HistoryList } from './itinerary'
type Template = Pick<
  components['schemas']['PackingTemplate'],
  'id' | 'name' | 'items'
>
export function MemberName({ member }: { member?: Entity }) {
  const name = String(member?.view?.fields.nickname ?? '已退出成员')
  return (
    <span className="row">
      <span aria-hidden="true">
        <Avatar
          name={name}
          src={member?.view?.fields.avatarUrl as string | null}
        />
      </span>
      <span>{name}</span>
    </span>
  )
}
function Assignee({
  members,
  value,
  onChange,
  label = '负责人',
}: {
  members: Entity[]
  value: string
  onChange: (id: string) => void
  label?: string
}) {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {members
          .filter((m) => !m.view?.fields.leftAt)
          .map((m) => (
            <option key={m.entityId} value={m.entityId}>
              {String(m.view?.fields.nickname)}
            </option>
          ))}
      </select>
    </label>
  )
}
function PackingEditor({
  db,
  trip,
  item,
  members,
  done,
}: {
  db: Database
  trip: Trip
  item: Entity | null
  members: Entity[]
  done: () => void
}) {
  const f = item?.view?.fields
  const [name, setName] = useState(String(f?.name ?? '')),
    [category, setCategory] = useState(String(f?.category ?? '')),
    [scope, setScope] = useState(String(f?.scope ?? 'personal')),
    [onlyMe, setOnlyMe] = useState(!!f?.ownerUserId),
    [assignee, setAssignee] = useState(String(f?.assigneeUserId ?? db.userId)),
    [busy, setBusy] = useState(false)
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          const fields = {
            name,
            category,
            ...(!item
              ? {
                  scope,
                  ...(scope === 'personal'
                    ? { ownerUserId: onlyMe ? db.userId : null }
                    : { assigneeUserId: assignee }),
                }
              : scope === 'shared'
                ? { assigneeUserId: assignee }
                : {}),
          }
          await writeEntity(
            db,
            trip.id,
            'packing_item',
            item?.entityId ?? crypto.randomUUID(),
            item ? 'update' : 'create',
            fields,
          )
          done()
        } catch (e) {
          toast.error(String(e))
        } finally {
          setBusy(false)
        }
      }}
    >
      <label>
        名称
        <input
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        分类
        <input
          maxLength={30}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
      </label>
      {!item && (
        <>
          <label>
            物品类型
            <select
              aria-label="物品类型"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="personal">个人物品</option>
              <option value="shared">公共物品</option>
            </select>
          </label>
          {scope === 'personal' && (
            <label className="member-check">
              <input
                type="checkbox"
                checked={onlyMe}
                onChange={(e) => setOnlyMe(e.target.checked)}
              />
              仅我需要带
            </label>
          )}
        </>
      )}
      {scope === 'shared' && (
        <Assignee members={members} value={assignee} onChange={setAssignee} />
      )}
      <Button loading={busy}>保存物品</Button>
    </form>
  )
}
function ApplyTemplate({
  template,
  db,
  trip,
  members,
  done,
}: {
  template: Template
  db: Database
  trip: Trip
  members: Entity[]
  done: () => void
}) {
  const [items, setItems] = useState<TemplateSelection[]>(() =>
      template.items.map((i) => ({ ...i, assigneeUserId: db.userId })),
    ),
    [busy, setBusy] = useState(false)
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await applyPackingTemplate(db, trip.id, items)
          done()
        } catch (e) {
          toast.error(String(e))
        } finally {
          setBusy(false)
        }
      }}
    >
      <p>为每件物品选择个人 / 公共，公共物品需要一位负责人。</p>
      {items.map((item, i) => (
        <ListCard key={i} title={item.name}>
          <label>
            {item.name}类型
            <select
              aria-label={`${item.name}类型`}
              value={item.scope}
              onChange={(e) =>
                setItems(
                  items.map((v, n) =>
                    n === i
                      ? { ...v, scope: e.target.value as 'personal' | 'shared' }
                      : v,
                  ),
                )
              }
            >
              <option value="personal">个人物品</option>
              <option value="shared">公共物品</option>
            </select>
          </label>
          {item.scope === 'shared' && (
            <Assignee
              label={`${item.name}负责人`}
              members={members}
              value={item.assigneeUserId!}
              onChange={(id) =>
                setItems(
                  items.map((v, n) =>
                    n === i ? { ...v, assigneeUserId: id } : v,
                  ),
                )
              }
            />
          )}
        </ListCard>
      ))}
      <Button loading={busy}>确认套用</Button>
    </form>
  )
}
export function Packing() {
  const { tripId = '' } = useParams(),
    user = useSession((s) => s.currentUser)!,
    db = database(user.id),
    online = useOnline()
  const trip = useLiveQuery(() => db.trips.get(tripId), [db, tripId]),
    items = useEntities(db, tripId, 'packing_item'),
    members = useEntities(db, tripId, 'member')
  const [editor, setEditor] = useState<Entity | null | undefined>(),
    [templatesOpen, setTemplatesOpen] = useState(false),
    [applying, setApplying] = useState<Template | null>(null),
    [saving, setSaving] = useState(false),
    [templateName, setTemplateName] = useState(''),
    [history, setHistory] = useState<Entity | null>(null)
  const cached = useLiveQuery(() => db.meta.get('packing-templates'), [db])
  const templates = (cached?.value ?? []) as Template[]
  useEffect(() => {
    if (online)
      void api
        .GET('/api/me/packing-templates')
        .then(
          ({ data }) =>
            data && db.meta.put({ key: 'packing-templates', value: data }),
        )
        .catch((e) => toast.error(String(e)))
  }, [online, db])
  if (!trip) return <main className="page">正在打开清单…</main>
  const personal = personalItems(
    items.flatMap((i) => (i.view ? [i.view] : [])),
    user.id,
  )
    .sort(comparePackingItems)
    .map((s) => items.find((i) => i.entityId === s.entityId)!)
  const shared = items
    .filter((i) => i.view?.fields.scope === 'shared')
    .sort(
      (a, b) =>
        Number(b.view!.fields.assigneeUserId === user.id) -
          Number(a.view!.fields.assigneeUserId === user.id) ||
        comparePackingItems(a.view!, b.view!),
    )
  const sections = [
    {
      title: '我的物品',
      rows: personal,
      checked: (i: Entity) => !!i.view?.fields[`checked.${user.id}`],
    },
    {
      title: '公共物品',
      rows: shared,
      checked: (i: Entity) => !!i.view?.fields.packed,
    },
  ]
  return (
    <main className="page stack">
      <h1>行李清单</h1>
      <div className="row">
        <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
          套用模板
        </Button>
        <Button
          variant="outline"
          disabled={!online || !items.length}
          onClick={() => setSaving(true)}
        >
          另存为模板
        </Button>
      </div>
      {sections.map(({ title, rows, checked }) => (
        <section className="stack" key={title}>
          <h2>{title}</h2>
          <label>
            {title === '我的物品' ? '我' : '公共'}已装{' '}
            {rows.filter(checked).length}/{rows.length}
            <progress
              aria-label={`${title}进度`}
              max={rows.length || 1}
              value={rows.filter(checked).length}
            />
          </label>
          {!rows.length && (
            <p className="muted">还没有物品，新增一件或套用模板。</p>
          )}
          {rows.map((item) => {
            const f = item.view!.fields,
              isShared = f.scope === 'shared',
              allowed =
                !isShared ||
                f.assigneeUserId === user.id ||
                trip.role === 'owner'
            return (
              <article
                key={item.entityId}
                data-testid="packing-item"
                onClick={(e) => {
                  if (
                    allowed &&
                    !(e.target as HTMLElement).closest(
                      'button, input, select, a',
                    )
                  )
                    e.currentTarget
                      .querySelector<HTMLButtonElement>('[role="checkbox"]')
                      ?.click()
                }}
              >
                <ListCard
                  title={
                    <button
                      type="button"
                      className="packing-toggle row"
                      role="checkbox"
                      aria-label={String(f.name)}
                      aria-checked={checked(item)}
                      disabled={!allowed}
                      onClick={() => {
                        void writeEntity(
                          db,
                          tripId,
                          'packing_item',
                          item.entityId,
                          'update',
                          isShared
                            ? { packed: !checked(item), packedBy: user.id }
                            : { [`checked.${user.id}`]: !checked(item) },
                        ).catch((e) => toast.error(String(e)))
                      }}
                    >
                      <span aria-hidden="true">
                        {checked(item) ? '☑' : '☐'}
                      </span>
                      {String(f.name)}
                    </button>
                  }
                  secondary={
                    isShared ? (
                      <MemberName
                        member={members.find(
                          (m) => m.entityId === f.assigneeUserId,
                        )}
                      />
                    ) : f.ownerUserId ? (
                      '仅我需要带'
                    ) : (
                      '每人一份'
                    )
                  }
                  description={String(f.category ?? '')}
                  status={checked(item) ? '已装' : '待装'}
                  menu={
                    <ActionMenu
                      label={`${f.name}操作`}
                      actions={[
                        { label: '编辑物品', onSelect: () => setEditor(item) },
                        { label: '修改记录', onSelect: () => setHistory(item) },
                        {
                          label: '删除物品',
                          danger: true,
                          onSelect: async () => {
                            await writeEntity(
                              db,
                              tripId,
                              'packing_item',
                              item.entityId,
                              'delete',
                            )
                            toast.undoable('物品已删除', () => {
                              void writeEntity(
                                db,
                                tripId,
                                'packing_item',
                                item.entityId,
                                'restore',
                              ).catch((e) => toast.error(String(e)))
                            })
                          },
                        },
                      ]}
                    />
                  }
                />
              </article>
            )
          })}
        </section>
      ))}
      <Fab aria-label="新增物品" onClick={() => setEditor(null)} />
      <ResponsiveOverlay
        open={editor !== undefined}
        onOpenChange={(o) => {
          if (!o) setEditor(undefined)
        }}
        title={editor ? '编辑物品' : '新增物品'}
      >
        {editor !== undefined && (
          <PackingEditor
            key={editor?.entityId ?? 'new'}
            db={db}
            trip={trip}
            item={editor}
            members={members}
            done={() => setEditor(undefined)}
          />
        )}
      </ResponsiveOverlay>
      <ResponsiveOverlay
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        title="选择模板"
      >
        <div className="stack">
          <h2>系统预设</h2>
          {packingPresets.map((t) => (
            <Button
              key={t.id}
              variant="outline"
              onClick={() => {
                setTemplatesOpen(false)
                setApplying(t)
              }}
            >
              {t.name}
            </Button>
          ))}
          <h2>我的模板</h2>
          {!templates.length && <p className="muted">暂无保存的模板</p>}
          {templates.map((t) => (
            <ListCard
              key={t.id}
              title={
                <Button
                  variant="ghost"
                  onClick={() => {
                    setTemplatesOpen(false)
                    setApplying(t)
                  }}
                >
                  {t.name}
                </Button>
              }
              menu={
                <ActionMenu
                  label={`${t.name}模板操作`}
                  actions={[
                    {
                      label: '删除模板',
                      disabled: !online,
                      danger: true,
                      onSelect: async () => {
                        await api.DELETE('/api/me/packing-templates/{id}', {
                          params: { path: { id: t.id } },
                        })
                        await db.meta.put({
                          key: 'packing-templates',
                          value: templates.filter((v) => v.id !== t.id),
                        })
                      },
                    },
                  ]}
                />
              }
            />
          ))}
        </div>
      </ResponsiveOverlay>
      <ResponsiveOverlay
        open={!!applying}
        onOpenChange={(o) => {
          if (!o) setApplying(null)
        }}
        title={`套用模板${applying ? ` · ${applying.name}` : ''}`}
      >
        {applying && (
          <ApplyTemplate
            key={applying.id}
            template={applying}
            db={db}
            trip={trip}
            members={members}
            done={() => setApplying(null)}
          />
        )}
      </ResponsiveOverlay>
      <ResponsiveOverlay
        open={saving}
        onOpenChange={setSaving}
        title="另存为模板"
      >
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              const { data } = await api.POST('/api/me/packing-templates', {
                body: {
                  name: templateName,
                  items: items.map((i) => ({
                    name: String(i.view!.fields.name),
                    category: String(i.view!.fields.category ?? ''),
                    scope: i.view!.fields.scope as 'personal' | 'shared',
                  })),
                },
              })
              if (data) {
                await db.meta.put({
                  key: 'packing-templates',
                  value: [...templates, data],
                })
                setSaving(false)
              }
            } catch (e) {
              toast.error(String(e))
            }
          }}
        >
          <label>
            模板名称
            <input
              required
              maxLength={100}
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
          </label>
          <Button disabled={!online || items.length > 200}>保存模板</Button>
          {items.length > 200 && <p>每个模板最多 200 项</p>}
        </form>
      </ResponsiveOverlay>
      <ResponsiveOverlay
        open={!!history}
        onOpenChange={(o) => {
          if (!o) setHistory(null)
        }}
        title="物品修改记录"
      >
        {history && (
          <HistoryList
            db={db}
            tripId={tripId}
            entity="packing_item"
            entityId={history.entityId}
          />
        )}
      </ResponsiveOverlay>
    </main>
  )
}
