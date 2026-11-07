export interface SecureStore {
  getToken(): Promise<string | null>
  setToken(token: string): Promise<void>
  clearToken(): Promise<void>
}
export const secureStore: SecureStore = {
  async getToken() {
    return null
  },
  async setToken() {
    throw new Error('Web 使用 Cookie，不存储 Bearer 令牌')
  },
  async clearToken() {},
}
