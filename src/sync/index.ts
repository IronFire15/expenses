import { useSyncExternalStore } from 'react'
import { db } from '@/db/db'
import { googleAccount } from './account'
import { GoogleDrive } from './drive'
import { SyncEngine } from './engine'

export const syncEngine = new SyncEngine(db, {
  createAuth: () => googleAccount,
  createDrive: () => new GoogleDrive(googleAccount),
})

export function useSyncStatus() {
  return useSyncExternalStore(syncEngine.subscribe, syncEngine.getStatus)
}

/** Start syncing on app load, when the device reconnects, and when the app returns to the foreground. */
export function startSync() {
  void syncEngine.init()
  window.addEventListener('online', () => void syncEngine.syncNow())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncEngine.syncIfStale()
  })
}
