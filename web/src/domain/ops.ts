import type { components } from '@/api/schema'
export type Op = components['schemas']['ClientOp']
export type ServerOp = components['schemas']['FullOp']
export type State = components['schemas']['EntityState']
export function emptyState(op: Op): State {
  return {
    entity: op.entity,
    entityId: op.entityId,
    fields: {},
    fieldSeq: {},
    fieldActor: {},
    createdBy: op.actorUserId,
    createdSeq: 0,
    updatedSeq: 0,
    deleted: false,
    deletedBy: null,
    deletedSeq: null,
  }
}
export function applyServer(state: State | null, op: ServerOp): State {
  if (state && state.updatedSeq >= op.serverSeq) return state
  const next = structuredClone(state ?? emptyState(op))
  if (op.kind === 'create') next.createdSeq = op.serverSeq
  for (const [field, change] of Object.entries(op.changes)) {
    if (field === 'deleted') continue
    next.fields[field] = change.new
    next.fieldSeq[field] = op.serverSeq
    next.fieldActor[field] = op.actorUserId
  }
  if (op.kind === 'delete' && op.changes.deleted) {
    next.deleted = true
    next.deletedBy = op.actorUserId
    next.deletedSeq = op.serverSeq
  }
  if (op.kind === 'restore' && op.changes.deleted) {
    next.deleted = false
    next.deletedBy = null
    next.deletedSeq = null
  }
  next.updatedSeq = op.serverSeq
  return next
}
export function replay(server: State | null, ops: Op[]): State | null {
  let view = server ? structuredClone(server) : null
  for (const op of ops) {
    if (!view && op.kind !== 'create') continue
    view ??= emptyState(op)
    if (op.kind === 'create' || op.kind === 'update')
      Object.assign(view.fields, op.fields)
    if (op.kind === 'delete' && !view.deleted) {
      view.deleted = true
      view.deletedBy = op.actorUserId
      view.deletedSeq = null
    }
    if (op.kind === 'restore' && view.deleted) {
      view.deleted = false
      view.deletedBy = null
      view.deletedSeq = null
    }
  }
  return view
}
