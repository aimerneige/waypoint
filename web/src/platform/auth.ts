import type { components } from '@/api/schema'
import type { SecureStore } from './secureStore'
export interface AuthPlatform {
  mode: 'cookie' | 'bearer'
  getAuthHeaders(): Promise<Record<string, string>>
  onLogin(resp: components['schemas']['AuthResult']): Promise<void>
  onLogout(): Promise<void>
}
export const auth: AuthPlatform = {
  mode: 'cookie',
  async getAuthHeaders() {
    return {}
  },
  async onLogin() {},
  async onLogout() {},
}
export function createBearerAuth(store: SecureStore): AuthPlatform {
  return {
    mode: 'bearer',
    async getAuthHeaders(): Promise<Record<string, string>> {
      const token = await store.getToken()
      return token ? { Authorization: `Bearer ${token}` } : {}
    },
    async onLogin(resp) {
      if (!resp.token) throw new Error('缺少会话令牌')
      await store.setToken(resp.token)
    },
    async onLogout() {
      await store.clearToken()
    },
  }
}
