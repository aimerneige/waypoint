import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { Database, writeEntity } from './db'
import { uploadDependencies } from './voucher-files'
import { ApiError } from '@/api/client'
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  apiUpload: vi.fn(),
}))
import { apiUpload } from '@/api/client'
import { SyncEngine, type Transport } from '@/sync/engine'
const databases: Database[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  for (const db of databases.splice(0)) await db.delete()
})
async function fixture() {
  vi.stubGlobal('location', { origin: 'http://localhost' })
  const db = new Database(crypto.randomUUID())
  databases.push(db)
  await db.trips.put({
    id: 'trip',
    name: 'x',
    startDate: '2026-12-01',
    endDate: '2026-12-01',
    timezone: 'Asia/Tokyo',
    baseCurrency: 'CNY',
    ownerId: db.userId,
    latestSeq: 0,
    lastSeq: 1,
    access: 'ok',
    role: 'owner',
    createdAt: '',
  })
  await db.uploads.put({
    fileId: 'file',
    tripId: 'trip',
    blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
    uploaded: false,
    progress: 0,
  })
  await writeEntity(db, 'trip', 'voucher', 'voucher', 'create', {
    fileId: 'file',
    title: '机票',
  })
  return db
}
it('文件未上传成功时不返回可推送操作，重试成功后才推送，已上传不会重复传', async () => {
  const db = await fixture(),
    batch = await db.outbox.toArray()
  vi.mocked(apiUpload).mockRejectedValueOnce(new TypeError('offline'))
  await expect(uploadDependencies(db, batch)).rejects.toThrow('offline')
  expect(await db.outbox.count()).toBe(1)
  expect((await db.uploads.get('file'))?.uploaded).toBe(false)
  vi.mocked(apiUpload).mockResolvedValueOnce({ sha256: 'hash' })
  expect(await uploadDependencies(db, batch)).toEqual(batch)
  expect((await db.uploads.get('file'))?.progress).toBe(100)
  await uploadDependencies(db, batch)
  expect(apiUpload).toHaveBeenCalledTimes(2)
})
it.each([
  [413, '文件过大'],
  [415, '格式不支持'],
  [409, '文件冲突'],
] as const)('上传 %d 回滚凭证且记录中文原因', async (status, message) => {
  const db = await fixture()
  vi.mocked(apiUpload).mockRejectedValueOnce(
    new ApiError('upload_error', 'error', status),
  )
  expect(await uploadDependencies(db, await db.outbox.toArray())).toEqual([])
  expect(await db.outbox.count()).toBe(0)
  expect((await db.rejected.toArray())[0].error.message).toBe(message)
  expect(
    (await db.entities.get(['trip', 'voucher', 'voucher']))?.view,
  ).toBeNull()
})

it('同步引擎等待文件依赖完成才调用 push', async () => {
  const db = await fixture()
  let finish!: (result: { sha256: string }) => void
  vi.mocked(apiUpload).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const push = vi
    .fn<Transport['push']>()
    .mockImplementation(async (_trip, ops) => ({
      results: ops.map((op) => ({
        opId: op.opId,
        status: 'accepted',
        serverSeq: 2,
      })),
    }))
  const net: Transport = {
    push,
    list: vi.fn(),
    snapshot: vi.fn(),
    pull: async () => ({ ops: [], latestSeq: 2, hasMore: false }),
  }
  const engine = new SyncEngine(db, net)
  const work = engine.sync('trip')
  await vi.waitFor(() => expect(apiUpload).toHaveBeenCalledOnce())
  expect(push).not.toHaveBeenCalled()
  finish({ sha256: 'hash' })
  await work
  expect(push).toHaveBeenCalledOnce()
  expect(push.mock.calls[0][1][0].fields.fileId).toBe('file')
  engine.stop()
})

it('停止同步后到达的文件拒绝不会重新写入已退出用户的数据', async () => {
  const db = await fixture()
  let active = true
  let reject!: (error: Error) => void
  vi.mocked(apiUpload).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      }),
  )
  const work = uploadDependencies(db, await db.outbox.toArray(), () => active)
  await vi.waitFor(() => expect(apiUpload).toHaveBeenCalledOnce())
  active = false
  reject(new ApiError('payload_too_large', '文件过大', 413))
  expect(await work).toEqual([])
  expect(await db.rejected.count()).toBe(0)
})
