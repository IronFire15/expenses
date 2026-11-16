import { clearAllData } from '@/db/clear'
import type { ExpensesDB } from '@/db/db'
import { SYNCED_TABLES } from '@/db/db'
import { recategorizeAll } from '@/rules/engine'
import { decrypt, DEFAULT_ITERATIONS, deriveKey, encrypt, fromBase64, randomSalt, readEnvelope, toBase64, WrongPassphraseError } from './crypto'
import { ConflictError, NeedsAuthError, type DriveApi } from './drive'
import { applySnapshot, emptySnapshot, exportSnapshot, isSnapshot, sameData, type Snapshot } from './snapshot'

export type SyncState =
  | { state: 'disconnected' } // turned off on this device
  | { state: 'starting' }
  | { state: 'connecting' }
  | { state: 'needs-passphrase'; mode: 'create' | 'unlock' }
  | { state: 'idle' | 'syncing' | 'offline' | 'needs-auth'; lastSyncedAt?: number }
  | { state: 'error'; message: string; lastSyncedAt?: number }

/** The signed-in Google account (account.ts in the app, a fake in tests). */
export interface AuthLike {
  /** Get a usable token, or throw NeedsAuthError when signed out. */
  ensure(): Promise<void>
  /** Sends you through Google's sign-in (in the app, the page navigates away). */
  signIn(): Promise<void>
}

interface StoredKey {
  key: CryptoKey
  salt: string
  iterations: number
}

export interface SyncDeps {
  createAuth(): AuthLike
  createDrive(auth: AuthLike): DriveApi
  iterations?: number
  debounceMs?: number
  now?: () => number
}

const META = {
  /** Set when you turn sync off on this device; otherwise sync starts by itself once you're signed in. */
  off: 'sync.off',
  key: 'sync.key',
  lastSyncedAt: 'sync.lastSyncedAt',
  lastBackupAt: 'sync.lastBackupAt',
  /** Set by "Clear all data": after the next successful sync, delete old versions of the Drive file and all backups. */
  purge: 'sync.purge',
} as const

const BACKUP_EVERY_MS = 7 * 86_400_000
const KEEP_BACKUPS = 12
const MAX_ATTEMPTS = 3

/**
 * Keeps this device and the Drive file in sync.
 *
 *  1. download + decrypt the Drive file
 *  2. merge it into the local database (newest version of each record wins, deletions included)
 *  3. if this device has anything newer, encrypt everything and upload,
 *     but only if nobody uploaded in between (otherwise start again from 1)
 *
 * Runs on start, 5 s after local changes, when the device comes back online, and on demand.
 */
export class SyncEngine {
  private status: SyncState = { state: 'starting' }
  private listeners = new Set<() => void>()
  private auth: AuthLike | null = null
  private drive: DriveApi | null = null
  private key: StoredKey | null = null
  private lastSyncedAt?: number
  private running: Promise<void> | null = null
  private rerun = false
  private timer: ReturnType<typeof setTimeout> | null = null
  /** True while we write remote data locally, so those writes don't schedule another upload. */
  private applying = false
  private hooked = false
  private db: ExpensesDB
  private deps: SyncDeps

  constructor(db: ExpensesDB, deps: SyncDeps) {
    this.db = db
    this.deps = deps
  }

  // ---------- status for React (useSyncExternalStore) ----------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getStatus = () => this.status
  private set(status: SyncState) {
    this.status = status
    this.listeners.forEach((fn) => fn())
  }
  private now() {
    return this.deps.now?.() ?? Date.now()
  }

  private async meta<T>(key: string): Promise<T | undefined> {
    return (await this.db.localMeta.get(key))?.value as T | undefined
  }
  private async setMeta(key: string, value: unknown) {
    if (value === undefined) await this.db.localMeta.delete(key)
    else await this.db.localMeta.put({ key, value })
  }

  // ---------- lifecycle ----------

  /** Restore state from this device, then sync. Sets up the Drive connection by itself the first time. */
  async init(): Promise<void> {
    this.attachHooks()
    // Left over from the old browser-only sign-in (client ID typed in Settings, 1-hour tokens).
    for (const k of ['sync.clientId', 'sync.token', 'sync.connected']) await this.setMeta(k, undefined)
    this.lastSyncedAt = await this.meta<number>(META.lastSyncedAt)
    this.auth = this.deps.createAuth()
    this.drive = this.deps.createDrive(this.auth)
    if (await this.meta<boolean>(META.off)) return this.set({ state: 'disconnected' })
    this.key = (await this.meta<StoredKey>(META.key)) ?? null
    if (!this.key) return this.connect().catch(() => {}) // connect() shows what's needed next
    this.set({ state: 'idle', lastSyncedAt: this.lastSyncedAt })
    await this.syncNow()
  }

  /** Look for the sync file in your Drive, then ask for the passphrase (create or unlock). */
  async connect(): Promise<void> {
    if (!this.auth || !this.drive) throw new Error('Sync isn’t ready yet.')
    await this.setMeta(META.off, undefined)
    this.set({ state: 'connecting' })
    try {
      await this.auth.ensure()
      const file = await this.drive.findSyncFile()
      this.set({ state: 'needs-passphrase', mode: file ? 'unlock' : 'create' })
    } catch (err) {
      if (err instanceof NeedsAuthError) this.set({ state: 'needs-auth' })
      else if (err instanceof TypeError) this.set({ state: 'offline' })
      else this.set({ state: 'error', message: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  /**
   * Step 2 of setup. 'create': new passphrase, encrypts and uploads this device's data.
   * 'unlock': checks the passphrase against the existing Drive file, then merges.
   */
  async setPassphrase(passphrase: string): Promise<void> {
    if (!this.drive) throw new Error('Not connected.')
    const iterations = this.deps.iterations ?? DEFAULT_ITERATIONS
    const file = await this.drive.findSyncFile()
    let stored: StoredKey
    if (file) {
      const env = readEnvelope(await this.drive.download(file.id))
      const key = await deriveKey(passphrase, fromBase64(env.kdf.salt), env.kdf.iterations)
      await decrypt(JSON.stringify(env), key) // throws WrongPassphraseError
      stored = { key, salt: env.kdf.salt, iterations: env.kdf.iterations }
    } else {
      const salt = randomSalt()
      stored = { key: await deriveKey(passphrase, salt, iterations), salt: toBase64(salt), iterations }
    }
    this.key = stored
    await this.setMeta(META.key, stored)
    this.set({ state: 'idle', lastSyncedAt: this.lastSyncedAt })
    await this.syncNow()
  }

  /** After "needs-auth": sign in again. In the app this leaves the page and sync resumes when you're back. */
  async signInAgain(): Promise<void> {
    await this.auth?.signIn()
    if (this.key) await this.syncNow()
    else await this.connect()
  }

  /** Stop syncing on this device and forget the passphrase. Local data and the Drive file stay. */
  async disconnect(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.key = null
    for (const k of [META.key, META.lastSyncedAt, META.lastBackupAt]) await this.setMeta(k, undefined)
    await this.setMeta(META.off, true)
    this.lastSyncedAt = undefined
    this.set({ state: 'disconnected' })
  }

  /**
   * Erase all data on this device, then in Google Drive: the next sync uploads the empty state
   * (other devices erase theirs when they sync), then deletes the old versions Drive keeps and the weekly backups.
   * Returns 'synced' when Drive is clean, 'pending' when that waits for the next successful sync,
   * 'local' when sync is off here (Drive is cleaned the next time sync is turned on).
   */
  async clearAllData(): Promise<'synced' | 'pending' | 'local'> {
    if (this.timer) clearTimeout(this.timer)
    // Let a sync already under way finish first, so the purge can't run before the empty state is uploaded.
    await this.running
    await this.setMeta(META.purge, true)
    await clearAllData(this.db, this.now())
    if (!this.key) return 'local'
    await this.syncNow()
    return (await this.meta<boolean>(META.purge)) ? 'pending' : 'synced'
  }

  private async purgeHistory(drive: DriveApi) {
    try {
      const file = await drive.findSyncFile()
      if (file) await drive.deleteOldRevisions(file.id)
      for (const b of await drive.listBackups()) await drive.deleteFile(b.id)
      await this.setMeta(META.purge, undefined)
    } catch (err) {
      console.warn('Deleting old Drive copies failed; will retry next sync.', err)
    }
  }

  // ---------- triggers ----------

  private attachHooks() {
    if (this.hooked) return
    this.hooked = true
    const onChange = () => {
      if (!this.applying) this.scheduleSoon()
    }
    for (const t of SYNCED_TABLES) {
      const table = this.db.table(t)
      table.hook('creating', onChange)
      table.hook('updating', onChange)
      table.hook('deleting', onChange)
    }
  }

  /** Sync a few seconds after the last local change (several quick edits = one upload). */
  scheduleSoon() {
    if (!this.key) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.syncNow(), this.deps.debounceMs ?? 5000)
  }

  /** Sync if the last successful sync is older than `ms` (used when the app comes back to the foreground). */
  syncIfStale(ms = 60_000): Promise<void> {
    if (this.lastSyncedAt && this.now() - this.lastSyncedAt < ms) return Promise.resolve()
    return this.syncNow()
  }

  /** Sync now. Concurrent calls share one run; a call during a run triggers one more run after it. */
  syncNow(): Promise<void> {
    if (!this.key || !this.drive) return Promise.resolve()
    if (this.running) {
      this.rerun = true
      return this.running
    }
    this.running = (async () => {
      do {
        this.rerun = false
        await this.runOnce()
      } while (this.rerun)
    })().finally(() => (this.running = null))
    return this.running
  }

  private async runOnce() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return this.set({ state: 'offline', lastSyncedAt: this.lastSyncedAt })
    this.set({ state: 'syncing', lastSyncedAt: this.lastSyncedAt })
    try {
      await this.exchange()
      if (await this.meta<boolean>(META.purge)) await this.purgeHistory(this.drive!)
      this.lastSyncedAt = this.now()
      await this.setMeta(META.lastSyncedAt, this.lastSyncedAt)
      this.set({ state: 'idle', lastSyncedAt: this.lastSyncedAt })
    } catch (err) {
      if (err instanceof NeedsAuthError) return this.set({ state: 'needs-auth', lastSyncedAt: this.lastSyncedAt })
      if (err instanceof WrongPassphraseError) {
        // The passphrase was changed on another device: ask for the new one.
        this.key = null
        await this.setMeta(META.key, undefined)
        return this.set({ state: 'needs-passphrase', mode: 'unlock' })
      }
      if (err instanceof TypeError) return this.set({ state: 'offline', lastSyncedAt: this.lastSyncedAt }) // fetch network failure
      this.set({ state: 'error', message: err instanceof Error ? err.message : String(err), lastSyncedAt: this.lastSyncedAt })
    }
  }

  private async exchange() {
    const drive = this.drive!
    const { key, salt, iterations } = this.key!
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const file = await drive.findSyncFile()
      let remote: Snapshot = emptySnapshot()
      if (file) {
        const data = await decrypt<unknown>(await drive.download(file.id), key)
        if (!isSnapshot(data)) throw new Error('The sync file has an unknown format. Was it made by a newer version of the app?')
        remote = data
        this.applying = true
        try {
          if (await applySnapshot(this.db, remote)) await recategorizeAll(this.db)
        } finally {
          this.applying = false
        }
      }

      const local = await exportSnapshot(this.db)
      if (file && sameData(local, remote)) return // nothing new on this device

      const content = await encrypt(local, key, fromBase64(salt), iterations)
      try {
        if (file) await drive.update(file.id, content, file.version)
        else await drive.create(content)
      } catch (err) {
        if (err instanceof ConflictError) continue // someone else uploaded: merge their data and retry
        throw err
      }
      await this.backupIfDue(drive, content)
      return
    }
    throw new Error('Another device kept syncing at the same time. Will try again shortly.')
  }

  /** Weekly dated copy in /Expenses/backups, keeping the latest 12. Never fails the sync. */
  private async backupIfDue(drive: DriveApi, content: string) {
    const last = (await this.meta<number>(META.lastBackupAt)) ?? 0
    if (this.now() - last < BACKUP_EVERY_MS) return
    try {
      const date = new Date(this.now()).toISOString().slice(0, 10)
      await drive.writeBackup(`expenses-${date}.json.enc`, content)
      await this.setMeta(META.lastBackupAt, this.now())
      const backups = await drive.listBackups()
      for (const old of backups.slice(KEEP_BACKUPS)) await drive.deleteFile(old.id)
    } catch (err) {
      console.warn('Backup to Drive failed; will retry next sync.', err)
    }
  }
}
