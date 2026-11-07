import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { Database } from './db'
import { applyPackingTemplate } from './packing'
it('模板创建独立 op 与乐观实体，绑定当前用户并保留公共负责人；失败原子回滚', async () => {
  const db = new Database(`packing-${crypto.randomUUID()}`)
  try {
    await db.trips.put({
      id: 'trip',
      name: '旅行',
      startDate: '2026-11-10',
      endDate: '2026-11-10',
      timezone: 'Asia/Tokyo',
      baseCurrency: 'CNY',
      ownerId: db.userId,
      latestSeq: 0,
      createdAt: '',
      role: 'owner',
      lastSeq: 0,
      access: 'ok',
    })
    const items = [
      { name: '护照', category: '证件', scope: 'personal' as const },
      {
        name: '相机',
        category: '',
        scope: 'shared' as const,
        assigneeUserId: 'b',
      },
    ]
    await applyPackingTemplate(db, 'trip', items)
    const ops = await db.outbox.toArray()
    expect(ops).toHaveLength(2)
    expect(new Set(ops.map((op) => op.opId)).size).toBe(2)
    expect(new Set(ops.map((op) => op.entityId)).size).toBe(2)
    expect(
      ops.every(
        (op) =>
          op.entity === 'packing_item' &&
          op.kind === 'create' &&
          op.actorUserId === db.userId &&
          op.tripId === 'trip' &&
          op.schemaVersion === 1,
      ),
    ).toBe(true)
    expect(ops[1].fields.assigneeUserId).toBe('b')
    expect(
      (await db.entities.toArray()).map((e) => e.view?.fields.name),
    ).toEqual(expect.arrayContaining(['护照', '相机']))
    await expect(
      applyPackingTemplate(db, 'unavailable', items),
    ).rejects.toThrow('无法修改该行程')
    expect(await db.outbox.count()).toBe(2)
  } finally {
    await db.delete()
  }
})
