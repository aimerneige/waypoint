import { create } from 'zustand'
export const useNotifications = create<{ messages: Record<string, string> }>(
  () => ({ messages: {} }),
)
export interface Notifications {
  schedule(message: string, at: Date, key?: string): Promise<void>
  remove(key: string): void
}
export const notify: Notifications = {
  async schedule(message: string, at: Date, key = 'reminder') {
    if (at.getTime() <= Date.now())
      useNotifications.setState((s) => ({
        messages: { ...s.messages, [key]: message },
      }))
  },
  remove(key: string) {
    useNotifications.setState((s) => ({
      messages: Object.fromEntries(
        Object.entries(s.messages).filter(([id]) => id !== key),
      ),
    }))
  },
}
