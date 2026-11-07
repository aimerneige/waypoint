import { describe, expect, it } from 'vitest'
import {
  compareItems,
  insertionKey,
  scheduledItems,
  sortKey,
  timeLabel,
} from './itinerary'
import {
  dayLabel,
  formatDate,
  formatDateTime,
  tripDays,
  validTimezone,
} from './format'
import { emptyState, type State } from './ops'
function item(id: string, fields: State['fields'], seq = 1): State {
  return {
    ...emptyState({
      entity: 'itinerary_item',
      entityId: id,
      actorUserId: 'a',
    } as Parameters<typeof emptyState>[0]),
    fields,
    createdSeq: seq,
  }
}
describe('行程排序与心愿推导', () => {
  it('无时间在前，再按时间、索引及创建序号排序；跨夜仍归开始日', () => {
    const rows = [
      item('late', {
        date: '2026-11-10',
        startTime: '23:00',
        endTime: '08:30',
        endDate: '2026-11-11',
      }),
      item('timed2', { startTime: '09:00', sortOrder: 'a1' }, 4),
      item('all2', { sortOrder: 'a1' }, 2),
      item('timed1', { startTime: '09:00', sortOrder: 'a0' }, 3),
      item('all1', { sortOrder: 'a0' }, 1),
      item('same', { startTime: '09:00', sortOrder: 'a1' }, 5),
    ]
    expect(rows.sort(compareItems).map((i) => i.entityId)).toEqual([
      'all1',
      'all2',
      'timed1',
      'timed2',
      'same',
      'late',
    ])
    expect(rows.at(-1)!.fields.date).toBe('2026-11-10')
  })
  it('分数索引可插入首尾和中间，兼容无索引旧实体', () => {
    const a = insertionKey(),
      b = insertionKey(a),
      middle = insertionKey(a, b)
    expect(a < middle && middle < b).toBe(true)
    expect(insertionKey(null, a) < a).toBe(true)
    const old1 = item('1', {}, 61),
      old2 = item('2', {}, 62)
    expect(compareItems(old1, old2)).toBeLessThan(0)
    expect(insertionKey(sortKey(old1), sortKey(old2))).toBeTruthy()
  })
  it('排除删除项，两次安排保留并按最早日期显示，恢复后重新计入', () => {
    const a = item('a', { wishItemId: 'w', date: '2026-11-12' }),
      b = item('b', { wishItemId: 'w', date: '2026-11-10' })
    const deleted = {
      ...item('deleted', { wishItemId: 'w', date: '2026-11-09' }),
      deleted: true,
    }
    expect(scheduledItems('w', [a, b, deleted]).map((i) => i.entityId)).toEqual(
      ['b', 'a'],
    )
    expect(
      scheduledItems('w', [a, b, { ...deleted, deleted: false }]),
    ).toHaveLength(3)
    expect(scheduledItems('other', [a, b])).toEqual([])
  })
})
describe('中文日期和当地时间', () => {
  it('无效时区在离线写入之前拒绝，避免格式化时抛错', () => {
    expect(validTimezone('Asia/Tokyo')).toBe(true)
    expect(validTimezone('UTC')).toBe(true)
    for (const zone of ['', 'Local', 'Mars/Olympus'])
      expect(validTimezone(zone)).toBe(false)
  })
  it('同年省略年份、跨年显示年份，时间为24小时中文格式', () => {
    const now = new Date('2026-11-07T12:00:00')
    expect(formatDate('2026-11-10', now)).toBe('11月10日')
    expect(formatDate('2027-01-01', now)).toBe('2027年1月1日')
    expect(formatDateTime('2026-11-07T10:02:38', now)).toBe('11月7日 10:02')
    expect(dayLabel('2026-11-10', 1)).toContain('第 2 天 · 11月10日 周二')
    expect(tripDays('2026-12-31', '2027-01-02')).toHaveLength(3)
  })
  it('未定时间、次日、跨多日与不同时区', () => {
    expect(timeLabel({}, 'Asia/Tokyo')).toBe('未定时间')
    expect(
      timeLabel(
        {
          date: '2026-11-10',
          startTime: '23:00',
          endTime: '08:30',
          endDate: '2026-11-11',
        },
        'Asia/Tokyo',
      ),
    ).toBe('23:00 → 次日 08:30')
    expect(
      timeLabel(
        {
          date: '2026-11-10',
          startTime: '14:05',
          timezone: 'Asia/Tokyo',
          endTime: '18:30',
          endTimezone: 'Europe/Paris',
        },
        'UTC',
      ),
    ).toBe('14:05 JST → 18:30 CET')
    expect(
      timeLabel(
        {
          date: '2026-11-10',
          startTime: '14:05',
          endTime: '18:30',
          endDate: '2026-11-12',
          endTimezone: 'Europe/Paris',
        },
        'Asia/Tokyo',
      ),
    ).toContain('→ 11月12日 18:30 CET（当地）')
  })
})
