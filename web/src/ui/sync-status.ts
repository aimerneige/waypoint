import { create } from 'zustand'
export const useSyncStatus = create<{
  state: 'synced' | 'syncing' | 'pending'
  pending: number
  rejected: number
  upgrade: boolean
}>(() => ({ state: 'synced', pending: 0, rejected: 0, upgrade: false }))
