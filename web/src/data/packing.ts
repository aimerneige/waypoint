import { type Database, writeEntity } from './db'
import { templateFields, type TemplateSelection } from '@/domain/packing'
export async function applyPackingTemplate(
  db: Database,
  tripId: string,
  items: TemplateSelection[],
) {
  // 一次本地事务保存整份模板，任何失败都不留下半份清单。
  await db.transaction('rw', db.trips, db.entities, db.outbox, async () => {
    for (const fields of templateFields(items, db.userId)) {
      await writeEntity(
        db,
        tripId,
        'packing_item',
        crypto.randomUUID(),
        'create',
        fields,
      )
    }
  })
}
