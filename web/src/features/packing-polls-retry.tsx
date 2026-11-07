import { useState } from 'react'
import { useEntities } from '@/data/hooks'
import { writeEntity, type Database, type Pending } from '@/data/db'
import { Button } from '@/ui/components/button'
import { toast } from '@/ui/toast'
export function PackingPollsRetry({
  db,
  retry,
  done,
}: {
  db: Database
  retry: Pending
  done: () => Promise<void>
}) {
  const [fields, setFields] = useState(retry.fields)
  const options = useEntities(db, retry.tripId, 'poll_option')
  const members = useEntities(db, retry.tripId, 'member')
  const names: Record<string, string> = {
    name: '名称',
    category: '分类',
    scope: '物品类型',
    ownerUserId: '仅此成员需要带',
    assigneeUserId: '负责人',
    packed: '已装',
    question: '问题',
    multiChoice: '允许多选',
    deadline: '截止时间',
    text: '选项内容',
  }
  const change = (key: string, value: unknown) =>
    setFields({ ...fields, [key]: value })
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await writeEntity(
            db,
            retry.tripId,
            retry.entity,
            retry.entityId,
            retry.kind,
            fields,
          )
          await done()
        } catch (e) {
          toast.error(String(e))
        }
      }}
    >
      {Object.entries(fields)
        .filter(([key]) => !['pollId', 'packedBy', 'sortOrder'].includes(key))
        .map(([key, value]) =>
          key.startsWith('vote.') ? (
            <fieldset key={key}>
              <legend>重新选择投票</legend>
              {options
                .filter((o) => o.view?.fields.pollId === retry.entityId)
                .map((o) => (
                  <label className="member-check" key={o.entityId}>
                    <input
                      type="checkbox"
                      checked={
                        Array.isArray(value) && value.includes(o.entityId)
                      }
                      onChange={(e) =>
                        change(
                          key,
                          e.target.checked
                            ? [
                                ...(Array.isArray(value) ? value : []),
                                o.entityId,
                              ]
                            : (Array.isArray(value) ? value : []).filter(
                                (id) => id !== o.entityId,
                              ),
                        )
                      }
                    />
                    {String(o.view?.fields.text)}
                  </label>
                ))}
            </fieldset>
          ) : typeof value === 'boolean' ? (
            <label className="member-check" key={key}>
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => change(key, e.target.checked)}
              />
              {key.startsWith('checked.') ? '我的勾选' : names[key]}
            </label>
          ) : (
            <label key={key}>
              {names[key] ?? '内容'}
              {key === 'scope' ? (
                <select
                  value={String(value)}
                  onChange={(e) => change(key, e.target.value)}
                >
                  <option value="personal">个人物品</option>
                  <option value="shared">公共物品</option>
                </select>
              ) : key.endsWith('UserId') ? (
                <select
                  value={String(value ?? '')}
                  onChange={(e) => change(key, e.target.value || null)}
                >
                  <option value="">所有成员</option>
                  {members
                    .filter((m) => !m.view?.fields.leftAt)
                    .map((m) => (
                      <option key={m.entityId} value={m.entityId}>
                        {String(m.view?.fields.nickname)}
                      </option>
                    ))}
                </select>
              ) : (
                <input
                  value={String(value ?? '')}
                  onChange={(e) => change(key, e.target.value || null)}
                />
              )}
            </label>
          ),
        )}
      {retry.entity === 'poll' && (
        <p className="muted">投票截止后不能重试，请返回详情确认状态。</p>
      )}
      <Button>提交修改</Button>
    </form>
  )
}
