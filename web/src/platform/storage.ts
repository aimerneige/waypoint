export interface FileStorage {
  put(userId: string, fileId: string, file: Blob): Promise<void>
  get(userId: string, fileId: string): Promise<Blob | null>
  delete(userId: string, fileId: string): Promise<void>
  list(userId: string): Promise<string[]>
  usage(userId: string): Promise<number>
}
const key = (user: string, file: string) => `/offline-files/${user}/${file}`
const cache = (user: string) => caches.open(`waypoint-credentials-${user}`)
export const storage: FileStorage = {
  async put(user, file, blob) {
    await (await cache(user)).put(key(user, file), new Response(blob))
  },
  async get(user, file) {
    return (await (await cache(user)).match(key(user, file)))?.blob() ?? null
  },
  async delete(user, file) {
    await (await cache(user)).delete(key(user, file))
  },
  async list(user) {
    return (await (await cache(user)).keys()).map((r) =>
      new URL(r.url).pathname.split('/').at(-1)!,
    )
  },
  async usage(user) {
    const entries = await this.list(user)
    let size = 0
    for (const id of entries) size += (await this.get(user, id))?.size ?? 0
    return size
  },
}
