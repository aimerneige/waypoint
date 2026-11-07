import { ApiError, apiFetch } from '@/api/client'
import type { components } from '@/api/schema'
import { applyServer } from '@/domain/ops'
import { type Database, recomputeTrip, type Trip } from '@/data/db'
type Schema = components['schemas']
export interface Transport {
  list(): Promise<Schema['TripList']>
  snapshot(id: string): Promise<Schema['Snapshot']>
  push(id: string, ops: Schema['ClientOp'][]): Promise<Schema['PushResult']>
  pull(id: string, after: number): Promise<Schema['PullResult']>
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(new URL(`/api${path}`, location.origin), {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return response.json()
}
export const transport: Transport = {
  list: () => request('/trips'),
  snapshot: (id) => request(`/trips/${id}/snapshot`),
  push: (id, ops) => request(`/trips/${id}/ops`, { ops }),
  pull: (id, after) => request(`/trips/${id}/ops?after=${after}&limit=500`),
}
export const retryDelay = (attempt: number, random = Math.random) =>
  Math.min(60000, 1000 * 2 ** Math.min(attempt, 6) * (1 + random() * 0.25))
export class SyncEngine {
  private flights = new Map<string, Promise<void>>()
  private again = new Set<string>()
  private retries = new Map<string, ReturnType<typeof setTimeout>>()
  private attempts = new Map<string, number>()
  private discovery?: Promise<void>
  stopped = false
  upgradeRequired = false
  constructor(
    public db: Database,
    private net: Transport = transport,
    private changed: (busy: boolean) => void = () => {},
    private expired: () => void = () => {},
  ) {}
  stop() {
    this.stopped = true
    for (const timer of this.retries.values()) clearTimeout(timer)
    this.retries.clear()
  }
  discover(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.discovery) return this.discovery
    this.discovery = this.discoverTrips().finally(() => {
      this.discovery = undefined
    })
    return this.discovery
  }
  private async discoverTrips() {
    if (this.stopped) return
    try {
      const { trips } = await this.net.list()
      if (this.stopped) return
      this.attempts.delete('discovery')
      const retry = this.retries.get('discovery')
      if (retry) clearTimeout(retry)
      this.retries.delete('discovery')
      for (const trip of trips) {
        if (this.stopped) return
        const old = await this.db.trips.get(trip.id)
        if (this.stopped) return
        await this.db.trips.put({
          ...trip,
          lastSeq: old?.access === 'ok' ? old.lastSeq : 0,
          access: 'ok',
        })
      }
      // 列表消失可能来自权限撤销或删除，逐行请求以获得准确原因。
      const cached = await this.db.trips.where('access').equals('ok').toArray()
      const queue = [...cached]
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          let trip
          while ((trip = queue.shift())) await this.sync(trip.id)
        }),
      )
    } catch (error) {
      this.handleAuth(error)
      if (!this.stopped) this.schedule('discovery', () => this.discover())
    }
  }
  private handleAuth(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      this.stop()
      this.expired()
    }
  }
  private schedule(id: string, action: () => Promise<void>) {
    if (this.retries.has(id) || this.stopped) return
    const attempt = this.attempts.get(id) ?? 0
    this.attempts.set(id, attempt + 1)
    this.retries.set(
      id,
      setTimeout(() => {
        this.retries.delete(id)
        void action()
      }, retryDelay(attempt)),
    )
  }
  sync(id: string): Promise<void> {
    if (this.stopped) return Promise.resolve()
    const flight = this.flights.get(id)
    if (flight) {
      this.again.add(id)
      return flight
    }
    let failed = false
    const work = this.run(id)
      .catch(async (error) => {
        failed = true
        this.handleAuth(error)
        if (
          error instanceof ApiError &&
          ((error.status === 403 && error.code === 'not_member') ||
            (error.status === 404 && error.code === 'trip_not_found'))
        )
          await this.revoke(id, error.status === 404 ? 'deleted' : 'revoked')
        else if (
          error instanceof ApiError &&
          (error.status === 426 ||
            error.code === 'upgrade_required' ||
            error.code === 'server_outdated')
        )
          this.upgradeRequired = true
        else if (!this.stopped) this.schedule(id, () => this.sync(id))
      })
      .finally(() => {
        this.flights.delete(id)
        this.changed(this.flights.size > 0)
        if (this.again.delete(id) && !this.stopped && !failed)
          void this.sync(id)
      })
    this.flights.set(id, work)
    this.changed(true)
    return work
  }
  async revoke(id: string, access: 'revoked' | 'deleted') {
    await this.db.transaction(
      'rw',
      [
        this.db.trips,
        this.db.entities,
        this.db.outbox,
        this.db.rejected,
        this.db.ops,
        this.db.notices,
        this.db.meta,
      ],
      async () => {
        const trip = await this.db.trips.get(id)
        if (!trip || trip.access !== 'ok') return
        const count = await this.db.outbox.where('tripId').equals(id).count()
        await this.db.trips.update(id, { access })
        for (const table of [
          this.db.entities,
          this.db.outbox,
          this.db.rejected,
          this.db.ops,
        ])
          await table.where('tripId').equals(id).delete()
        await this.db.meta.delete(`invites:${id}`)
        await this.db.notices.where('tripId').equals(id).delete()
        await this.db.notices.add({
          tripId: id,
          message:
            access === 'revoked'
              ? `你已被移出行程 ${trip.name}，${count} 条未同步修改已丢弃`
              : `行程 ${trip.name} 已删除，${count} 条未同步修改已丢弃`,
        })
      },
    )
  }
  private async run(id: string) {
    let trip = await this.db.trips.get(id)
    if (!trip || trip.access !== 'ok' || this.stopped) return
    if (trip.lastSeq === 0) {
      const snapshot = await this.net.snapshot(id)
      if (this.stopped) return
      await this.db.transaction(
        'rw',
        this.db.trips,
        this.db.entities,
        this.db.outbox,
        async () => {
          if ((await this.db.trips.get(id))?.access !== 'ok') return
          const pending = await this.db.outbox
            .where('tripId')
            .equals(id)
            .toArray()
          for (const op of pending)
            if (op.acceptedSeq !== undefined && op.acceptedSeq <= snapshot.seq)
              await this.db.outbox.delete(op.localId!)
          await this.db.entities.where('tripId').equals(id).delete()
          for (const server of snapshot.entities)
            await this.db.entities.put({
              tripId: id,
              entity: server.entity,
              entityId: server.entityId,
              server,
              view: server,
            })
          for (const op of pending)
            if (!(await this.db.entities.get([id, op.entity, op.entityId])))
              await this.db.entities.put({
                tripId: id,
                entity: op.entity,
                entityId: op.entityId,
                server: null,
                view: null,
              })
          await recomputeTrip(this.db, id)
          await this.db.trips.put({
            ...snapshot.trip,
            lastSeq: snapshot.seq,
            access: 'ok',
          })
        },
      )
    }
    while (!this.stopped && !this.upgradeRequired) {
      if ((await this.db.trips.get(id))?.access !== 'ok') return
      const batch = (
        await this.db.outbox.where('tripId').equals(id).sortBy('localId')
      )
        .filter((op) => op.acceptedSeq === undefined)
        .slice(0, 200)
      if (!batch.length) break
      const result = await this.net.push(
        id,
        batch.map((op) => ({
          opId: op.opId,
          tripId: op.tripId,
          actorUserId: op.actorUserId,
          schemaVersion: op.schemaVersion,
          entity: op.entity,
          entityId: op.entityId,
          kind: op.kind,
          fields: op.fields,
          baseSeq: op.baseSeq,
          clientTime: op.clientTime,
        })),
      )
      if (this.stopped) return
      await this.db.transaction(
        'rw',
        this.db.trips,
        this.db.outbox,
        this.db.rejected,
        this.db.entities,
        this.db.notices,
        async () => {
          if ((await this.db.trips.get(id))?.access !== 'ok') return
          for (const item of result.results) {
            const op = batch.find((op) => op.opId === item.opId)
            if (!op) throw new Error('Unknown push result')
            if (item.status === 'rejected') {
              if (
                ['upgrade_required', 'server_outdated'].includes(
                  item.error?.code ?? '',
                )
              ) {
                this.upgradeRequired = true
                continue
              }
              if (
                ![
                  'invalid_op',
                  'actor_mismatch',
                  'entity_readonly',
                  'entity_exists',
                  'entity_not_found',
                ].includes(item.error?.code ?? '')
              )
                throw new Error(item.error?.message ?? 'Temporary rejection')
              await this.db.rejected.put({ ...op, error: item.error! })
              await this.db.outbox.delete(op.localId!)
            } else {
              if (item.serverSeq === undefined)
                throw new Error('Missing accepted sequence')
              await this.db.outbox.update(op.localId!, {
                acceptedSeq: item.serverSeq,
              })
            }
          }
          await recomputeTrip(this.db, id)
        },
      )
      if (result.results.length !== batch.length)
        throw new Error('Incomplete push response')
    }
    let hasMore = true
    while (hasMore && !this.stopped) {
      trip = (await this.db.trips.get(id))!
      if (trip.access !== 'ok') return
      const page = await this.net.pull(id, trip.lastSeq)
      if (this.stopped) return
      await this.db.transaction(
        'rw',
        [
          this.db.trips,
          this.db.entities,
          this.db.outbox,
          this.db.ops,
          this.db.notices,
        ],
        async () => {
          if ((await this.db.trips.get(id))?.access !== 'ok') return
          for (const op of page.ops) {
            const row = await this.db.entities.get([id, op.entity, op.entityId])
            await this.db.entities.put({
              tripId: id,
              entity: op.entity,
              entityId: op.entityId,
              server: applyServer(row?.server ?? null, op),
              view: null,
            })
            await this.db.ops.put(op)
            if (op.conflicts?.length || op.entityDeleted)
              await this.db.notices.add({
                tripId: id,
                entity: op.entity,
                entityId: op.entityId,
                serverSeq: op.serverSeq,
                message: op.entityDeleted
                  ? '修改的实体已被删除，可选择恢复'
                  : '修改覆盖了其他成员的值',
              })
          }
          const cursor = page.hasMore
            ? page.ops.at(-1)?.serverSeq
            : page.latestSeq
          if (cursor === undefined || (page.hasMore && cursor <= trip!.lastSeq))
            throw new Error('Invalid pull cursor')
          for (const op of await this.db.outbox
            .where('tripId')
            .equals(id)
            .toArray())
            if (op.acceptedSeq !== undefined && op.acceptedSeq <= cursor)
              await this.db.outbox.delete(op.localId!)
          await recomputeTrip(this.db, id)
          const state = await this.db.entities.get([id, 'trip', id])
          const member = await this.db.entities.get([
            id,
            'member',
            this.db.userId,
          ])
          await this.db.trips.update(id, {
            ...state?.view?.fields,
            role: String(member?.view?.fields.role ?? trip!.role),
            lastSeq: cursor,
          } as Partial<Trip>)
        },
      )
      hasMore = page.hasMore
    }
    this.attempts.delete(id)
    const timer = this.retries.get(id)
    if (timer) clearTimeout(timer)
    this.retries.delete(id)
  }
}
