import { expect, it } from 'vitest'
import { applyServer, replay, type Op, type ServerOp } from './ops'
const op: Op = {
  opId: 'a',
  tripId: 't',
  actorUserId: 'u',
  schemaVersion: 1,
  entity: 'itinerary_item',
  entityId: 'e',
  kind: 'create',
  fields: { title: 'A', date: '2027-01-01' },
  baseSeq: {},
  clientTime: '',
}
function full(kind: Op['kind'], seq: number, fields = op.fields): ServerOp {
  return {
    ...op,
    kind,
    fields,
    serverSeq: seq,
    serverTime: '',
    changes:
      kind === 'delete' || kind === 'restore'
        ? { deleted: { old: kind !== 'delete', new: kind === 'delete' } }
        : Object.fromEntries(
            Object.entries(fields).map(([key, value]) => [
              key,
              { old: null, new: value },
            ]),
          ),
    conflicts: [],
    entityDeleted: false,
    origin: 'client',
  }
}
it('applies create/update/delete/restore and ignores duplicate server operations', () => {
  const created = applyServer(null, full('create', 1))
  expect(created.fieldSeq.title).toBe(1)
  const deleted = applyServer(created, full('delete', 2, {}))
  const updated = applyServer(deleted, full('update', 3, { title: 'B' }))
  expect(updated.deleted).toBe(true)
  expect(updated.fields.title).toBe('B')
  const duplicateDelete = applyServer(updated, {
    ...full('delete', 4, {}),
    actorUserId: 'other',
    changes: {},
  })
  expect(duplicateDelete.deletedBy).toBe('u')
  expect(duplicateDelete.deletedSeq).toBe(2)
  expect(applyServer(updated, full('update', 3))).toBe(updated)
  const restored = applyServer(duplicateDelete, full('restore', 5, {}))
  expect(restored).toMatchObject({
    deleted: false,
    deletedBy: null,
    deletedSeq: null,
  })
})
it('replays in local order and rolls back by removing rejected operations', () => {
  const server = applyServer(null, full('create', 1))
  const a = { ...op, kind: 'update' as const, fields: { title: 'B' } }
  const b = { ...a, fields: { title: 'C' } }
  expect(replay(server, [a, b])?.fields.title).toBe('C')
  expect(replay(server, [a])?.fields.title).toBe('B')
  expect(replay(server, [])).toEqual(server)
  expect(server.fields.title).toBe('A')
  expect(replay(null, [op, { ...op, kind: 'delete' }, a])?.deleted).toBe(true)
  expect(
    replay(null, [op, { ...op, kind: 'delete' }, { ...op, kind: 'restore' }])
      ?.deleted,
  ).toBe(false)
})
