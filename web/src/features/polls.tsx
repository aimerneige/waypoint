import { useEffect, useState } from 'react'
import { generateKeyBetween } from 'fractional-indexing'
import { Link, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { database, writeEntity, type Database, type Entity } from '@/data/db'
import { useEntities } from '@/data/hooks'
import { useSession } from '@/platform/session'
import { api } from '@/api/client'
import { isPollClosed, pollCounts, deadlineText } from '@/domain/polls'
import { ActionMenu } from '@/ui/action-menu'
import { ListCard } from '@/ui/list-card'
import { ResponsiveOverlay } from '@/ui/responsive-overlay'
import { Fab } from '@/ui/shell'
import { Button } from '@/ui/components/button'
import { toast } from '@/ui/components/sonner'
import { useOnline } from '@/ui/hooks'
import { MemberName } from './packing'
import { HistoryList } from './itinerary'
function localTime(value: unknown) {
  if (!value) return ''
  const d = new Date(String(value))
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}
function PollEditor({
  db,
  tripId,
  poll,
  done,
}: {
  db: Database
  tripId: string
  poll: Entity | null
  done: () => void
}) {
  const [question, setQuestion] = useState(
      String(poll?.view?.fields.question ?? ''),
    ),
    [multi, setMulti] = useState(!!poll?.view?.fields.multiChoice),
    [deadline, setDeadline] = useState(localTime(poll?.view?.fields.deadline)),
    [options, setOptions] = useState(['', '']),
    [busy, setBusy] = useState(false)
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          const id = poll?.entityId ?? crypto.randomUUID()
          await db.transaction(
            'rw',
            db.trips,
            db.entities,
            db.outbox,
            async () => {
              await writeEntity(
                db,
                tripId,
                'poll',
                id,
                poll ? 'update' : 'create',
                {
                  question,
                  multiChoice: multi,
                  deadline: deadline ? new Date(deadline).toISOString() : null,
                },
              )
              let sortOrder: string | null = null
              if (!poll) {
                for (const text of options) {
                  sortOrder = generateKeyBetween(sortOrder, null)
                  await writeEntity(
                    db,
                    tripId,
                    'poll_option',
                    crypto.randomUUID(),
                    'create',
                    { pollId: id, text, sortOrder },
                  )
                }
              }
            },
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
        问题
        <input
          required
          maxLength={200}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>
      <label className="member-check">
        <input
          type="checkbox"
          checked={multi}
          onChange={(e) => setMulti(e.target.checked)}
        />
        允许多选
      </label>
      <label>
        截止时间（设备当地时间）
        <input
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
      </label>
      {!poll && (
        <>
          {options.map((text, i) => (
            <div className="row" key={i}>
              <label>
                选项 {i + 1}
                <input
                  required
                  maxLength={100}
                  value={text}
                  onChange={(e) =>
                    setOptions(
                      options.map((v, n) => (n === i ? e.target.value : v)),
                    )
                  }
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                aria-label={`移除选项 ${i + 1}`}
                disabled={options.length <= 2}
                onClick={() => setOptions(options.filter((_, n) => n !== i))}
              >
                移除
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={options.length >= 200}
            onClick={() => setOptions([...options, ''])}
          >
            添加选项
          </Button>
        </>
      )}
      <Button loading={busy}>保存投票</Button>
    </form>
  )
}
export function Polls() {
  const { tripId = '', pollId } = useParams(),
    user = useSession((s) => s.currentUser)!,
    db = database(user.id),
    online = useOnline()
  const trip = useLiveQuery(() => db.trips.get(tripId), [db, tripId]),
    polls = useEntities(db, tripId, 'poll'),
    options = useEntities(db, tripId, 'poll_option'),
    members = useEntities(db, tripId, 'member')
  const [editor, setEditor] = useState<Entity | null | undefined>(),
    [history, setHistory] = useState<Entity | null>(null),
    [optionEdit, setOptionEdit] = useState<Entity | null | undefined>(),
    [optionText, setOptionText] = useState(''),
    [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const selected = polls.find((p) => p.entityId === pollId)
  const states = options.flatMap((o) => (o.view ? [o.view] : []))
  const pollMenu = (p: Entity) => {
    const creator = p.view?.createdBy === user.id,
      manager = creator || trip?.role === 'owner'
    return (
      <ActionMenu
        label={`${p.view?.fields.question}操作`}
        actions={[
          ...(creator
            ? [{ label: '编辑投票', onSelect: () => setEditor(p) }]
            : []),
          ...(manager
            ? [
                {
                  label: '关闭投票',
                  disabled: !online || isPollClosed(p.view!, now),
                  onSelect: async () => {
                    await api.POST('/api/trips/{tripId}/polls/{pollId}/close', {
                      params: { path: { tripId, pollId: p.entityId } },
                    })
                  },
                },
                {
                  label: '删除投票',
                  danger: true,
                  onSelect: async () => {
                    await writeEntity(db, tripId, 'poll', p.entityId, 'delete')
                    toast.undoable('投票已删除', () => {
                      void writeEntity(
                        db,
                        tripId,
                        'poll',
                        p.entityId,
                        'restore',
                      ).catch((e) => toast.error(String(e)))
                    })
                  },
                },
              ]
            : []),
          { label: '修改记录', onSelect: () => setHistory(p) },
        ]}
      />
    )
  }
  const vote = async (ids: string[]) => {
    try {
      await writeEntity(db, tripId, 'poll', selected!.entityId, 'update', {
        [`vote.${user.id}`]: ids,
      })
    } catch (e) {
      toast.error(String(e))
    }
  }
  const tally = selected ? pollCounts(selected.view!, states) : null
  const closed = selected ? isPollClosed(selected.view!, now) : false
  const chosen = (selected?.view?.fields[`vote.${user.id}`] ?? []) as string[]
  return (
    <main className="page stack">
      <Link to={`/trips/${tripId}/more`}>返回更多</Link>
      <h1>{pollId ? '投票详情' : '投票'}</h1>
      {pollId ? (
        selected ? (
          <>
            <ListCard
              title={String(selected.view!.fields.question)}
              secondary={deadlineText(selected.view!, now)}
              status={
                closed
                  ? '已截止'
                  : selected.view!.fields.multiChoice
                    ? '多选'
                    : '单选'
              }
              menu={pollMenu(selected)}
            />
            <p>{tally!.total} 人已投票 · 实名可见</p>
            {tally!.counts.map(({ option, users, count }) => (
              <ListCard
                key={option.entityId}
                title={
                  <label className="packing-toggle row">
                    <input
                      type={
                        selected.view!.fields.multiChoice ? 'checkbox' : 'radio'
                      }
                      name="poll-vote"
                      checked={chosen.includes(option.entityId)}
                      disabled={closed}
                      onChange={() => {
                        void vote(
                          selected.view!.fields.multiChoice
                            ? chosen.includes(option.entityId)
                              ? chosen.filter((id) => id !== option.entityId)
                              : [...chosen, option.entityId]
                            : [option.entityId],
                        )
                      }}
                    />
                    {String(option.fields.text)}
                  </label>
                }
                secondary={`${count} 票 · ${tally!.total ? Math.round((count / tally!.total) * 100) : 0}%`}
                menu={
                  option.createdBy === user.id ||
                  selected.view?.createdBy === user.id ? (
                    <ActionMenu
                      label={`${option.fields.text}选项操作`}
                      actions={[
                        {
                          label: '编辑选项',
                          disabled: closed,
                          onSelect: () => {
                            setOptionEdit(
                              options.find(
                                (o) => o.entityId === option.entityId,
                              )!,
                            )
                            setOptionText(String(option.fields.text))
                          },
                        },
                        {
                          label: '删除选项',
                          disabled: closed,
                          danger: true,
                          onSelect: async () => {
                            await writeEntity(
                              db,
                              tripId,
                              'poll_option',
                              option.entityId,
                              'delete',
                            )
                          },
                        },
                      ]}
                    />
                  ) : undefined
                }
              >
                <progress
                  aria-label={`${option.fields.text}比例`}
                  value={count}
                  max={tally!.total || 1}
                />
                <div className="row voters">
                  {users.map((id) => (
                    <MemberName
                      key={id}
                      member={members.find((m) => m.entityId === id)}
                    />
                  ))}
                </div>
              </ListCard>
            ))}
            <div className="row">
              <Button
                variant="outline"
                disabled={closed || !chosen.length}
                onClick={() => {
                  void vote([])
                }}
              >
                撤票
              </Button>
              <Button
                disabled={closed}
                onClick={() => {
                  setOptionText('')
                  setOptionEdit(null)
                }}
              >
                追加选项
              </Button>
            </div>
            {closed && <p role="status">已截止，不能继续投票</p>}
            <Link to={`/trips/${tripId}/polls`}>返回投票列表</Link>
          </>
        ) : (
          <p>
            投票不存在或已删除{' '}
            <Link to={`/trips/${tripId}/polls`}>返回列表</Link>
          </p>
        )
      ) : (
        <>
          {[false, true].map((ended) => (
            <section className="stack" key={String(ended)}>
              <h2>{ended ? '已结束' : '进行中'}</h2>
              {polls
                .filter((p) => isPollClosed(p.view!, now) === ended)
                .map((p) => {
                  const { counts, total } = pollCounts(p.view!, states),
                    leading = [...counts].sort((a, b) => b.count - a.count)[0]
                  return (
                    <ListCard
                      key={p.entityId}
                      title={
                        <Link to={`/trips/${tripId}/polls/${p.entityId}`}>
                          {String(p.view!.fields.question)}
                        </Link>
                      }
                      status={p.view!.fields.multiChoice ? '多选' : '单选'}
                      secondary={deadlineText(p.view!, now)}
                      description={`${total} 人已投票${leading?.count ? ` · 领先：${leading.option.fields.text}（${leading.count} 票）` : ''}`}
                      menu={pollMenu(p)}
                    />
                  )
                })}
            </section>
          ))}
          {!polls.length && (
            <p className="muted">一起决定旅途中的小事，发起第一个投票。</p>
          )}
          <Fab aria-label="新建投票" onClick={() => setEditor(null)} />
        </>
      )}
      <ResponsiveOverlay
        open={editor !== undefined}
        onOpenChange={(o) => {
          if (!o) setEditor(undefined)
        }}
        title={editor ? '编辑投票' : '新建投票'}
      >
        {editor !== undefined && (
          <PollEditor
            key={editor?.entityId ?? 'new'}
            db={db}
            tripId={tripId}
            poll={editor}
            done={() => setEditor(undefined)}
          />
        )}
      </ResponsiveOverlay>
      <ResponsiveOverlay
        open={optionEdit !== undefined}
        onOpenChange={(o) => {
          if (!o) setOptionEdit(undefined)
        }}
        title={optionEdit ? '编辑选项' : '追加选项'}
      >
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await writeEntity(
                db,
                tripId,
                'poll_option',
                optionEdit?.entityId ?? crypto.randomUUID(),
                optionEdit ? 'update' : 'create',
                {
                  text: optionText,
                  ...(!optionEdit
                    ? {
                        pollId,
                        sortOrder: generateKeyBetween(
                          (tally?.counts.at(-1)?.option.fields.sortOrder as
                            string | null) ?? null,
                          null,
                        ),
                      }
                    : {}),
                },
              )
              setOptionEdit(undefined)
            } catch (e) {
              toast.error(String(e))
            }
          }}
        >
          <label>
            选项内容
            <input
              required
              maxLength={100}
              value={optionText}
              onChange={(e) => setOptionText(e.target.value)}
            />
          </label>
          <Button disabled={closed}>保存选项</Button>
        </form>
      </ResponsiveOverlay>
      <ResponsiveOverlay
        open={!!history}
        onOpenChange={(o) => {
          if (!o) setHistory(null)
        }}
        title="投票修改记录"
      >
        {history && (
          <HistoryList
            db={db}
            tripId={tripId}
            entity="poll"
            entityId={history.entityId}
          />
        )}
      </ResponsiveOverlay>
    </main>
  )
}
