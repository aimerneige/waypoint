import { useLiveQuery } from 'dexie-react-hooks'
import type { Database } from './db'
export function useEntities(db: Database, tripId: string, entity: string) {
  return useLiveQuery(
    async () =>
      (
        await db.entities
          .where('[tripId+entity]')
          .equals([tripId, entity])
          .toArray()
      ).filter((row) => row.view && !row.view.deleted),
    [db, tripId, entity],
    [],
  )
}
