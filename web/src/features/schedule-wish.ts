import { writeEntity, type Database, type Trip, type Entity } from '@/data/db'
import { compareItems, insertionKey, sortKey } from '@/domain/itinerary'
import { toast } from '@/ui/toast'
export async function scheduleWish(
  db: Database,
  trip: Trip,
  wish: Entity,
  date: string,
) {
  const rows = await db.entities
    .where('[tripId+entity]')
    .equals([trip.id, 'itinerary_item'])
    .toArray()
  const items = rows
    .flatMap((r) =>
      r.view &&
      !r.view.deleted &&
      r.view.fields.date === date &&
      !r.view.fields.startTime
        ? [r.view]
        : [],
    )
    .sort(compareItems)
  const id = crypto.randomUUID()
  await writeEntity(db, trip.id, 'itinerary_item', id, 'create', {
    title: wish.view!.fields.title,
    place: wish.view!.fields.place ?? null,
    wishItemId: wish.entityId,
    date,
    sortOrder: insertionKey(items.length ? sortKey(items.at(-1)!) : null),
  })
  toast.undoable('已安排到行程', () => {
    void writeEntity(db, trip.id, 'itinerary_item', id, 'delete').catch((e) =>
      toast.error(String(e)),
    )
  })
}
