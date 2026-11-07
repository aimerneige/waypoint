import { describe, expect, it } from 'vitest'
import { departureReminder, templateFields } from './packing'
import { packingPresets } from './packing-presets'
import { isPollClosed, pollCounts } from './polls'
import { emptyState, type State, type Op } from './ops'
const state = (
  id: string,
  fields: State['fields'],
  deleted = false,
): State => ({
  ...emptyState({
    entity: 'packing_item',
    entityId: id,
    actorUserId: 'a',
  } as Op),
  fields,
  deleted,
})
describe('出发提醒', () => {
  const trip = { startDate: '2026-11-10', timezone: 'Asia/Tokyo' }
  const items = [
    state('p', { scope: 'personal' }),
    state('mine', { scope: 'personal', ownerUserId: 'a', 'checked.a': true }),
    state('other', { scope: 'personal', ownerUserId: 'b' }),
    state('s', { scope: 'shared', assigneeUserId: 'a' }),
    state('otherS', { scope: 'shared', assigneeUserId: 'b' }),
    state('deleted', { scope: 'personal' }, true),
  ]
  it('按行程时区在前 3 天午夜开始，排除他人及已删除物品', () => {
    expect(
      departureReminder(trip, items, 'a', new Date('2026-11-06T14:59:59Z')),
    ).toBeNull()
    expect(
      departureReminder(trip, items, 'a', new Date('2026-11-06T15:00:00Z')),
    ).toEqual({ today: '2026-11-07', personal: 1, shared: 1 })
  })
  it('出发当天提醒，之后停止；跨日期线仍按行程时区', () => {
    expect(
      departureReminder(trip, items, 'a', new Date('2026-11-10T14:59:59Z')),
    ).not.toBeNull()
    expect(
      departureReminder(trip, items, 'a', new Date('2026-11-10T15:00:00Z')),
    ).toBeNull()
    expect(
      departureReminder(
        { ...trip, timezone: 'Pacific/Honolulu' },
        items,
        'a',
        new Date('2026-11-07T09:59:59Z'),
      ),
    ).toBeNull()
    expect(departureReminder(trip, [], 'a', new Date('2026-11-08'))).toBeNull()
  })
})
describe('模板生成', () => {
  it('四份预设均为 15–30 项，公共项指定负责人，个人项无共享状态', () => {
    for (const preset of packingPresets) {
      expect(preset.items.length).toBeGreaterThanOrEqual(15)
      expect(preset.items.length).toBeLessThanOrEqual(30)
    }
    const fields = templateFields(
      [
        { name: '护照', category: '证件', scope: 'personal' },
        { name: '备份', category: '', scope: 'shared', assigneeUserId: 'b' },
        { name: '相机', category: '', scope: 'shared' },
      ],
      'a',
    )
    expect(fields[0]).not.toHaveProperty('assigneeUserId')
    expect(fields[0]).not.toHaveProperty('packed')
    expect(fields[1].assigneeUserId).toBe('b')
    expect(fields[2].assigneeUserId).toBe('a')
    expect(fields.map((f) => f.sortOrder)).toEqual(
      [...fields.map((f) => f.sortOrder)].sort(),
    )
  })
})
describe('投票统计', () => {
  it('选项按分数索引排序，保持创建与追加顺序', () => {
    const options = [
      state('later', { pollId: 'p', sortOrder: 'a1' }),
      state('first', { pollId: 'p', sortOrder: 'a0' }),
    ]
    expect(
      pollCounts(state('p', {}), options).counts.map((c) => c.option.entityId),
    ).toEqual(['first', 'later'])
  })
  const options = [
    state('o1', { pollId: 'p' }),
    state('o2', { pollId: 'p' }),
    state('o3', { pollId: 'p' }, true),
    state('foreign', { pollId: 'other' }),
  ]
  it('多选按人数作分母；撤票、不存在和已删除选项不计', () => {
    const poll = state('p', {
      'vote.a': ['o1', 'o2'],
      'vote.b': ['o2'],
      'vote.c': [],
      'vote.d': ['o3', 'missing', 'foreign'],
    })
    const result = pollCounts(poll, options)
    expect(result.total).toBe(2)
    expect(result.counts.map((c) => [c.count, c.users])).toEqual([
      [1, ['a']],
      [2, ['a', 'b']],
    ])
    poll.fields['vote.a'] = []
    expect(pollCounts(poll, options).total).toBe(1)
  })
  it('截止日期与手动关闭均禁投', () => {
    expect(
      isPollClosed(
        state('p', { deadline: '2026-11-07T12:00:00Z' }),
        new Date('2026-11-07T12:00:01Z'),
      ),
    ).toBe(true)
    expect(isPollClosed(state('p', { closedAt: '2026-11-07T00:00:00Z' }))).toBe(
      true,
    )
    expect(isPollClosed(state('p', {}))).toBe(false)
  })
})
