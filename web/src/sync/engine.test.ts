import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { Database, createEntity, updateEntity } from '@/data/db'
import { applyServer, type ServerOp } from '@/domain/ops'
import { ApiError } from '@/api/client'
import { SyncEngine, retryDelay, type Transport } from './engine'
import type { components } from '@/api/schema'
const trip = {
  id: 't',
  name: '测试',
  startDate: '2027-01-01',
  endDate: '2027-01-02',
  timezone: 'Asia/Tokyo',
  baseCurrency: 'CNY',
  ownerId: 'u',
  latestSeq: 0,
  createdAt: '',
  role: 'owner',
}
class Server implements Transport {
  logs: ServerOp[] = []
  reject = false
  list = async () => ({ trips: [trip] })
  snapshot = async () => {
    const states = new Map<string, components['schemas']['EntityState']>()
    for (const op of this.logs)
      states.set(op.entityId, applyServer(states.get(op.entityId) ?? null, op))
    return {
      seq: this.logs.length,
      trip,
      members: [],
      entities: [...states.values()],
    }
  }
  push = async (_id: string, ops: components['schemas']['ClientOp'][]) => ({
    results: ops.map((op) => {
      const old = this.logs.find((log) => log.opId === op.opId)
      if (old)
        return {
          opId: op.opId,
          status: 'duplicate' as const,
          serverSeq: old.serverSeq,
        }
      if (this.reject)
        return {
          opId: op.opId,
          status: 'rejected' as const,
          error: { code: 'invalid_op', message: 'rejected' },
        }
      const seq = this.logs.length + 1
      let state = null
      for (const log of this.logs.filter((log) => log.entityId === op.entityId))
        state = applyServer(state, log)
      const conflicts = Object.keys(op.fields)
        .filter(
          (key) =>
            (state?.fieldSeq[key] ?? 0) > (op.baseSeq[key] ?? 0) &&
            state?.fields[key] !== op.fields[key],
        )
        .map((key) => ({
          field: key,
          overwrittenValue: state!.fields[key],
          overwrittenSeq: state!.fieldSeq[key],
          overwrittenActor: 'other',
        }))
      this.logs.push({
        ...op,
        serverSeq: seq,
        serverTime: '',
        changes: Object.fromEntries(
          Object.entries(op.fields).map(([key, value]) => [
            key,
            { old: state?.fields[key] ?? null, new: value },
          ]),
        ),
        conflicts,
        entityDeleted: false,
        origin: 'client',
      })
      return {
        opId: op.opId,
        status: 'accepted' as const,
        serverSeq: seq,
        conflicts,
      }
    }),
  })
  pull = async (_id: string, after: number) => ({
    ops: this.logs.filter((op) => op.serverSeq > after),
    latestSeq: this.logs.length,
    hasMore: false,
  })
}
const dbs: Database[] = []
const engines: SyncEngine[] = []
async function setup() {
  const db = new Database(crypto.randomUUID())
  dbs.push(db)
  await db.trips.put({ ...trip, lastSeq: 1, access: 'ok' })
  const server = new Server()
  const engine = new SyncEngine(db, server)
  engines.push(engine)
  return { db, server, engine }
}
afterEach(async () => {
  for (const engine of engines) engine.stop()
  for (const db of dbs) await db.delete()
  vi.useRealTimers()
})
it('pushes then pulls; retains accepted overlays until the cursor passes', async () => {
  const { db, server, engine } = await setup()
  await db.trips.update('t', { lastSeq: 0 })
  const id = await createEntity(db, 't', 'itinerary_item', { title: 'A' })
  const pull = server.pull.bind(server)
  server.pull = async (...args) => {
    expect((await db.outbox.toArray())[0].acceptedSeq).toBe(1)
    expect(
      (await db.entities.get(['t', 'itinerary_item', id]))?.view?.fields.title,
    ).toBe('A')
    return pull(...args)
  }
  await engine.sync('t')
  expect(await db.outbox.count()).toBe(0)
  expect(await db.ops.count()).toBe(1)
  expect(
    (await db.entities.get(['t', 'itinerary_item', id]))?.server?.fields.title,
  ).toBe('A')
})
it('rolls back rejected changes and records conflict notices', async () => {
  const { db, server, engine } = await setup()
  await db.trips.update('t', { lastSeq: 0 })
  const id = await createEntity(db, 't', 'itinerary_item', { title: 'A' })
  await engine.sync('t')
  server.reject = true
  await updateEntity(db, 't', 'itinerary_item', id, { title: 'B' })
  await engine.sync('t')
  expect(await db.rejected.count()).toBe(1)
  expect(
    (await db.entities.get(['t', 'itinerary_item', id]))?.view?.fields.title,
  ).toBe('A')
  server.reject = false
  await server.push('t', [
    {
      ...server.logs[0],
      opId: 'remote',
      kind: 'update',
      fields: { title: 'remote' },
    },
  ])
  await updateEntity(db, 't', 'itinerary_item', id, { title: 'local' })
  await engine.sync('t')
  expect(
    (await db.notices.toArray()).some((notice) => notice.type === 'conflict'),
  ).toBe(true)
  expect(
    (await db.entities.get(['t', 'itinerary_item', id]))?.view?.fields.title,
  ).toBe('local')
})
it('backs off on temporary errors and keeps the queue on 401', async () => {
  const { db, server, engine } = await setup()
  await createEntity(db, 't', 'itinerary_item', { title: 'A' })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  server.push = vi.fn().mockRejectedValue(new TypeError('offline'))
  await engine.sync('t')
  expect(server.push).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(499)
  expect(server.push).toHaveBeenCalledTimes(1)
  expect(retryDelay(20, () => 1)).toBe(60000)
  await vi.advanceTimersByTimeAsync(800)
  await vi.waitFor(() => expect(server.push).toHaveBeenCalledTimes(2))
  server.push = vi.fn().mockRejectedValue(new ApiError('unauthorized', '', 401))
  await engine.sync('t')
  expect(engine.stopped).toBe(true)
  vi.useRealTimers()
  expect(await db.outbox.count()).toBe(1)
})
it('resumes the same queue after login and deduplicates a lost push response', async () => {
  const { db, server, engine } = await setup()
  await db.trips.update('t', { lastSeq: 0 })
  const id = await createEntity(db, 't', 'itinerary_item', { title: 'A' })
  const push = server.push.bind(server)
  server.push = async (...args) => {
    await push(...args)
    throw new TypeError('response lost')
  }
  await engine.sync('t')
  engine.stop()
  expect(await db.outbox.count()).toBe(1)
  server.push = push
  const resumed = new SyncEngine(db, server)
  engines.push(resumed)
  await resumed.sync('t')
  expect(server.logs).toHaveLength(1)
  expect(await db.outbox.count()).toBe(0)
  expect(
    (await db.entities.get(['t', 'itinerary_item', id]))?.view?.fields.title,
  ).toBe('A')
})
it('batches in local order and follows pagination across invisible sequence numbers', async () => {
  const { db, server, engine } = await setup()
  await db.trips.update('t', { lastSeq: 0 })
  for (let i = 0; i < 201; i++)
    await createEntity(db, 't', 'itinerary_item', { title: String(i) })
  const push = vi.spyOn(server, 'push')
  const afters: number[] = []
  server.pull = async (_id, after) => {
    afters.push(after)
    return after === 0
      ? { ops: server.logs.slice(0, 100), latestSeq: 500, hasMore: true }
      : { ops: server.logs.slice(100), latestSeq: 500, hasMore: false }
  }
  const first = engine.sync('t')
  expect(engine.sync('t')).toBe(first)
  await first
  expect(push.mock.calls.map((call) => call[1].length)).toEqual([200, 1])
  expect(server.logs.map((op) => op.fields.title)).toEqual(
    Array.from({ length: 201 }, (_, i) => String(i)),
  )
  expect(afters.slice(0, 2)).toEqual([0, 100])
  expect((await db.trips.get('t'))?.lastSeq).toBe(500)
  expect(await db.outbox.count()).toBe(0)
})
it('retains version-rejected work and stops pushing until upgrade', async () => {
  const { db, server, engine } = await setup()
  await createEntity(db, 't', 'itinerary_item', { title: 'A' })
  server.push = vi
    .fn()
    .mockRejectedValue(new ApiError('upgrade_required', '', 426))
  await engine.sync('t')
  await engine.sync('t')
  expect(engine.upgradeRequired).toBe(true)
  expect(server.push).toHaveBeenCalledTimes(1)
  expect(await db.outbox.count()).toBe(1)
  expect(await db.rejected.count()).toBe(0)
})
it('clears revoked trip data and pending work while preserving the tombstone', async () => {
  const { db, server, engine } = await setup()
  await createEntity(db, 't', 'itinerary_item', { title: 'A' })
  server.push = vi.fn().mockRejectedValue(new ApiError('not_member', '', 403))
  await engine.sync('t')
  expect((await db.trips.get('t'))?.access).toBe('revoked')
  expect(await db.outbox.count()).toBe(0)
  expect(await db.entities.count()).toBe(0)
  expect((await db.notices.toArray())[0].message).toContain(
    '1 条未同步修改已丢弃',
  )
})
it('only notifies conflict participants, once per op and field, and not deleted remote editors', async () => {
  const { db, server, engine } = await setup()
  const op: ServerOp = {
    opId: 'conflict',
    tripId: 't',
    actorUserId: 'stranger',
    schemaVersion: 1,
    entity: 'itinerary_item',
    entityId: 'item',
    kind: 'update',
    fields: { title: 'new' },
    baseSeq: {},
    clientTime: '',
    serverSeq: 2,
    serverTime: '',
    changes: { title: { old: 'old', new: 'new' } },
    conflicts: [
      {
        field: 'title',
        overwrittenValue: 'old',
        overwrittenSeq: 1,
        overwrittenActor: 'someone',
      },
    ],
    entityDeleted: true,
    origin: 'client',
  }
  server.logs = [op]
  await engine.sync('t')
  expect(await db.notices.count()).toBe(0)
  await db.trips.update('t', { lastSeq: 1 })
  op.conflicts![0].overwrittenActor = db.userId
  await engine.sync('t')
  expect(await db.notices.toArray()).toMatchObject([
    {
      type: 'conflict',
      direction: 'overwritten',
      oldValue: 'old',
      newValue: 'new',
      otherUserId: 'stranger',
    },
  ])
  await db.trips.update('t', { lastSeq: 1 })
  await engine.sync('t')
  expect(await db.notices.count()).toBe(1)
})
it('creates deleted notices from own push results and deduplicates retries', async () => {
  const { db, server, engine } = await setup()
  await db.trips.update('t', { lastSeq: 0 })
  const id = await createEntity(db, 't', 'itinerary_item', { title: 'A' })
  await engine.sync('t')
  await updateEntity(db, 't', 'itinerary_item', id, { title: 'B' })
  const push = server.push.bind(server)
  server.push = async (...args) => ({
    results: (await push(...args)).results.map((result) => ({
      ...result,
      entityDeleted: true,
      deletedBy: 'deleter',
    })),
  })
  await engine.sync('t')
  expect(await db.notices.toArray()).toMatchObject([
    { type: 'deleted', otherUserId: 'deleter', entityId: id },
  ])
  await engine.sync('t')
  expect(await db.notices.count()).toBe(1)
})
