import Dexie, { type Table } from 'dexie'
import type { components } from '@/api/schema'
import { replay, type Op, type State, type ServerOp } from '@/domain/ops'
export type Trip = components['schemas']['Trip'] & {
  lastSeq: number
  access: 'ok' | 'revoked' | 'deleted'
}
export type Entity = {
  tripId: string
  entity: string
  entityId: string
  server: State | null
  view: State | null
}
export type Pending = Op & { localId?: number; acceptedSeq?: number }
export type Notice = {
  id?: number
  tripId: string
  message?: string
  seen?: boolean
  dismissed?: boolean
  type?: 'conflict' | 'deleted'
  entity?: string
  entityId?: string
  serverSeq?: number
  field?: string
  oldValue?: unknown
  newValue?: unknown
  otherUserId?: string
  direction?: 'overwrote' | 'overwritten'
  key?: string
}
export class Database extends Dexie {
  trips!: Table<Trip, string>
  entities!: Table<Entity, [string, string, string]>
  outbox!: Table<Pending, number>
  rejected!: Table<
    Pending & { error: { code: string; message: string } },
    string
  >
  ops!: Table<ServerOp, [string, number]>
  notices!: Table<Notice, number>
  meta!: Table<{ key: string; value: unknown }, string>
  constructor(public userId: string) {
    super(`waypoint-u-${userId}`)
    this.version(1).stores({
      trips: 'id,access',
      entities: '[tripId+entity+entityId],[tripId+entity],tripId',
      outbox: '++localId,tripId,opId',
      rejected: 'opId,tripId',
      ops: '[tripId+serverSeq],tripId',
      notices: '++id,tripId',
      meta: 'key',
    })
    this.version(2).stores({ notices: '++id,tripId,&key' })
  }
}
const databases = new Map<string, Database>()
export function database(userId: string) {
  let db = databases.get(userId)
  if (!db) {
    db = new Database(userId)
    databases.set(userId, db)
  }
  return db
}
export async function deleteDatabase(userId: string) {
  const db = database(userId)
  await db.delete()
  databases.delete(userId)
}
export async function recompute(db: Database, row: Entity) {
  const pending = (
    await db.outbox.where('tripId').equals(row.tripId).sortBy('localId')
  ).filter((op) => op.entity === row.entity && op.entityId === row.entityId)
  await db.entities.put({ ...row, view: replay(row.server, pending) })
}
export async function recomputeTrip(db: Database, tripId: string) {
  const rows = await db.entities.where('tripId').equals(tripId).toArray()
  const pending = await db.outbox
    .where('tripId')
    .equals(tripId)
    .sortBy('localId')
  const grouped = new Map<string, Pending[]>()
  for (const op of pending) {
    const key = JSON.stringify([op.entity, op.entityId])
    const group = grouped.get(key) ?? []
    group.push(op)
    grouped.set(key, group)
  }
  await db.entities.bulkPut(
    rows.map((row) => ({
      ...row,
      view: replay(
        row.server,
        grouped.get(JSON.stringify([row.entity, row.entityId])) ?? [],
      ),
    })),
  )
}
export const localWrites = new EventTarget()
export async function writeEntity(
  db: Database,
  tripId: string,
  entity: string,
  entityId: string,
  kind: Op['kind'],
  fields: Op['fields'] = {},
) {
  if (entity === 'trip' || entity === 'member')
    throw new Error('请使用在线管理接口')
  await db.transaction('rw', db.trips, db.entities, db.outbox, async () => {
    if ((await db.trips.get(tripId))?.access !== 'ok')
      throw new Error('无法修改该行程')
    const row = (await db.entities.get([tripId, entity, entityId])) ?? {
      tripId,
      entity,
      entityId,
      server: null,
      view: null,
    }
    const baseSeq = Object.fromEntries(
      Object.keys(fields).map((key) => [key, row.server?.fieldSeq[key] ?? 0]),
    )
    await db.outbox.add({
      opId: crypto.randomUUID(),
      tripId,
      actorUserId: db.userId,
      schemaVersion: 1,
      entity,
      entityId,
      kind,
      fields,
      baseSeq,
      clientTime: new Date().toISOString(),
    })
    await recompute(db, row)
  })
  localWrites.dispatchEvent(new CustomEvent('write', { detail: { tripId } }))
}
export const createEntity = (
  db: Database,
  tripId: string,
  entity: string,
  fields: Op['fields'],
) => {
  const id = crypto.randomUUID()
  return writeEntity(db, tripId, entity, id, 'create', fields).then(() => id)
}
export const updateEntity = (
  db: Database,
  tripId: string,
  entity: string,
  id: string,
  fields: Op['fields'],
) => writeEntity(db, tripId, entity, id, 'update', fields)
export const deleteEntity = (
  db: Database,
  tripId: string,
  entity: string,
  id: string,
) => writeEntity(db, tripId, entity, id, 'delete')
export const restoreEntity = (
  db: Database,
  tripId: string,
  entity: string,
  id: string,
) => writeEntity(db, tripId, entity, id, 'restore')
