import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExpensesDB } from '@/db/db'
import { listActive, makeRecord, softDelete, updateRecord } from '@/db/records'
import { seedDefaults } from '@/db/seed'
import type { Category, Transaction } from '@/db/types'
import { WrongPassphraseError } from './crypto'
import { ConflictError, NeedsAuthError, type BackupFile, type DriveApi, type RemoteFile } from './drive'
import { SyncEngine, type AuthLike } from './engine'

/** In-memory stand-in for Google Drive, shared by the "devices". */
class FakeDrive implements DriveApi {
  file: { id: string; content: string; version: number } | null = null
  backups: (BackupFile & { content: string })[] = []
  uploads = 0
  /** Simulate another device writing right before our update. */
  interloper: (() => void) | null = null
  authed = true

  private check() {
    if (!this.authed) throw new NeedsAuthError()
  }
  async findSyncFile() {
    this.check()
    return this.file ? { id: this.file.id, version: String(this.file.version) } : null
  }
  async download(id: string) {
    this.check()
    if (this.file?.id !== id) throw new Error('not found')
    return this.file.content
  }
  async create(content: string): Promise<RemoteFile> {
    this.check()
    this.uploads++
    this.file = { id: 'f1', content, version: 1 }
    return { id: 'f1', version: '1' }
  }
  async update(id: string, content: string, expectedVersion: string): Promise<RemoteFile> {
    this.check()
    if (this.interloper) {
      const run = this.interloper
      this.interloper = null
      run()
    }
    if (!this.file || this.file.id !== id) throw new Error('not found')
    if (String(this.file.version) !== expectedVersion) throw new ConflictError()
    this.uploads++
    this.file = { id, content, version: this.file.version + 1 }
    return { id, version: String(this.file.version) }
  }
  async writeBackup(name: string, content: string) {
    this.backups.unshift({ id: `b${this.backups.length}`, name, createdTime: new Date().toISOString(), content })
  }
  async listBackups() {
    return this.backups
  }
  async deleteFile(id: string) {
    this.backups = this.backups.filter((b) => b.id !== id)
  }
  revisionPurges = 0
  async deleteOldRevisions() {
    this.revisionPurges++
  }
}

let signedIn = true
const fakeAuth = (): AuthLike => ({
  ensure: async () => {
    if (!signedIn) throw new NeedsAuthError()
  },
  signIn: async () => {
    signedIn = true
  },
})

let clock = Date.parse('2026-11-13T10:00:00Z')
function device(drive: FakeDrive) {
  const db = new ExpensesDB(`test-${crypto.randomUUID()}`)
  const engine = new SyncEngine(db, {
    createAuth: fakeAuth,
    createDrive: () => drive,
    iterations: 1000,
    debounceMs: 60_000, // tests call syncNow() themselves
    now: () => clock,
  })
  return { db, engine }
}

const tx = (over: Partial<Transaction> = {}) =>
  makeRecord<Transaction>({ accountId: 'acc', date: '2026-10-01', description: 'COMPRA LIDL', amount: -1000, tags: [], ...over })

let drive: FakeDrive
let A: ReturnType<typeof device>
let B: ReturnType<typeof device>

beforeEach(async () => {
  clock += 1000
  signedIn = true
  drive = new FakeDrive()
  A = device(drive)
  B = device(drive)
  for (const d of [A, B]) {
    await d.db.open()
    await seedDefaults(d.db)
    await d.engine.init()
  }
})
afterEach(async () => {
  await A.db.delete()
  await B.db.delete()
})

async function setUp(d: typeof A, passphrase = 'a long sync passphrase') {
  await d.engine.connect()
  await d.engine.setPassphrase(passphrase)
}

describe('sync between two devices', () => {
  it('first device creates the encrypted file; second unlocks it and gets the data', async () => {
    await A.db.transactions.add(tx({ id: 't1' }))
    await setUp(A)
    expect(A.engine.getStatus()).toMatchObject({ state: 'idle' })
    expect(drive.file?.content).not.toContain('LIDL') // encrypted

    await B.engine.connect()
    expect(B.engine.getStatus()).toEqual({ state: 'needs-passphrase', mode: 'unlock' })
    await expect(B.engine.setPassphrase('wrong passphrase')).rejects.toBeInstanceOf(WrongPassphraseError)
    await B.engine.setPassphrase('a long sync passphrase')
    expect((await B.db.transactions.get('t1'))?.description).toBe('COMPRA LIDL')
  })

  it('edits and deletions travel both ways and both devices converge', async () => {
    await A.db.transactions.bulkAdd([tx({ id: 't1' }), tx({ id: 't2', description: 'COMPRA CONTINENTE' })])
    await setUp(A)
    await setUp(B)

    clock += 1000
    await updateRecord(B.db.transactions, 't1', { notes: 'from phone' })
    await softDelete(B.db.transactions, 't2')
    await B.engine.syncNow()
    await A.engine.syncNow()

    expect((await A.db.transactions.get('t1'))?.notes).toBe('from phone')
    expect((await listActive(A.db.transactions)).map((t) => t.id)).toEqual(['t1'])
  })

  it('offline edits on both devices merge record by record; the newer edit of the same record wins', async () => {
    await A.db.transactions.bulkAdd([tx({ id: 't1' }), tx({ id: 't2' })])
    await setUp(A)
    await setUp(B)

    await A.db.transactions.put({ ...(await A.db.transactions.get('t1'))!, notes: 'A', updatedAt: Date.now() + 10_000 })
    await B.db.transactions.put({ ...(await B.db.transactions.get('t1'))!, notes: 'B (newer)', updatedAt: Date.now() + 20_000 })
    await A.db.transactions.add(tx({ id: 'onlyA' }))
    await B.db.transactions.add(tx({ id: 'onlyB' }))

    await A.engine.syncNow()
    await B.engine.syncNow()
    await A.engine.syncNow()

    for (const d of [A, B]) {
      expect((await d.db.transactions.get('t1'))?.notes).toBe('B (newer)')
      expect(await d.db.transactions.get('onlyA')).toBeDefined()
      expect(await d.db.transactions.get('onlyB')).toBeDefined()
    }
  })

  it('retries when another device uploads in between, keeping both changes', async () => {
    await setUp(A)
    await setUp(B)

    await A.db.transactions.add(tx({ id: 'fromA' }))
    drive.interloper = () => {
      // B uploads while A is mid-sync.
      void B.db.transactions.add(tx({ id: 'fromB' })).then(() => B.engine.syncNow())
    }
    // Let B's write land before A checks the version.
    const origUpdate = drive.update.bind(drive)
    drive.update = async (...args) => {
      if (drive.interloper) {
        const run = drive.interloper
        drive.interloper = null
        run()
        await new Promise((r) => setTimeout(r, 50))
      }
      return origUpdate(...args)
    }

    await A.engine.syncNow()
    await B.engine.syncNow()
    for (const d of [A, B]) {
      expect(await d.db.transactions.get('fromA')).toBeDefined()
      expect(await d.db.transactions.get('fromB')).toBeDefined()
    }
  })

  it('clear all data erases every device and the Drive history, keeping fresh defaults', async () => {
    await A.db.transactions.add(tx({ id: 't1' }))
    await A.db.categories.add(makeRecord<Category>({ id: 'mine', name: 'Mine', type: 'expense', color: '#000', icon: 'x' }))
    await updateRecord(A.db.categories, 'cat-groceries', { name: 'Food' })
    await setUp(A)
    await setUp(B)
    expect(drive.backups.length).toBeGreaterThan(0)

    clock = Date.now() + 10_000
    expect(await A.engine.clearAllData()).toBe('synced')
    expect(drive.revisionPurges).toBe(1)
    expect(drive.backups).toEqual([])

    await B.engine.syncNow()
    for (const d of [A, B]) {
      expect(await d.db.transactions.get('t1')).toEqual({ id: 't1', updatedAt: clock, deleted: true }) // no content left
      expect(await listActive(d.db.transactions)).toEqual([])
      expect((await d.db.categories.get('mine'))?.deleted).toBe(true)
      expect((await d.db.categories.get('cat-groceries'))?.name).toBe('Groceries')
      expect((await listActive(d.db.rules)).length).toBeGreaterThan(50)
    }
  })

  it('clear all data with sync off only touches this device, and cleans Drive once sync is back', async () => {
    await A.db.transactions.add(tx({ id: 't1' }))
    await setUp(A)
    await A.engine.disconnect()
    clock = Date.now() + 10_000
    expect(await A.engine.clearAllData()).toBe('local')
    expect(drive.revisionPurges).toBe(0)

    await setUp(A)
    expect(drive.revisionPurges).toBe(1)
    await setUp(B)
    expect(await listActive(B.db.transactions)).toEqual([])
  })

  it('does not upload when nothing changed', async () => {
    await setUp(A)
    const uploads = drive.uploads
    await A.engine.syncNow()
    await A.engine.syncNow()
    expect(drive.uploads).toBe(uploads)
  })

  it('asks to sign in again when the token expires, and keeps local data', async () => {
    await A.db.transactions.add(tx({ id: 't1' }))
    await setUp(A)
    drive.authed = false
    await A.db.transactions.add(tx({ id: 't2' }))
    await A.engine.syncNow()
    expect(A.engine.getStatus()).toMatchObject({ state: 'needs-auth' })
    expect(await A.db.transactions.count()).toBe(2)

    drive.authed = true
    await A.engine.signInAgain()
    expect(A.engine.getStatus()).toMatchObject({ state: 'idle' })
  })

  it('keeps weekly backups, at most 12', async () => {
    await setUp(A)
    expect(drive.backups).toHaveLength(1)
    await A.db.transactions.add(tx())
    await A.engine.syncNow()
    expect(drive.backups).toHaveLength(1) // same week

    for (let i = 0; i < 15; i++) {
      clock += 8 * 86_400_000
      await A.db.transactions.add(tx())
      await A.engine.syncNow()
    }
    expect(drive.backups).toHaveLength(12)
  })

  it('remembers the setup after a restart (key stays on the device)', async () => {
    await setUp(A)
    const again = new SyncEngine(A.db, {
      createAuth: fakeAuth,
      createDrive: () => drive,
        iterations: 1000,
      now: () => clock,
    })
    await again.init()
    expect(again.getStatus()).toMatchObject({ state: 'idle' })
  })

  it('connects by itself on first start when signed in, and waits for sign-in otherwise', async () => {
    expect(A.engine.getStatus()).toEqual({ state: 'needs-passphrase', mode: 'create' })

    signedIn = false
    const C = device(drive)
    await C.db.open()
    await C.engine.init()
    expect(C.engine.getStatus()).toMatchObject({ state: 'needs-auth' })
    await C.engine.signInAgain()
    expect(C.engine.getStatus()).toEqual({ state: 'needs-passphrase', mode: 'create' })
    await C.db.delete()
  })

  it('stays off after you turn it off, until you turn it on again', async () => {
    await setUp(A)
    await A.engine.disconnect()
    const again = new SyncEngine(A.db, { createAuth: fakeAuth, createDrive: () => drive, iterations: 1000, now: () => clock })
    await again.init()
    expect(again.getStatus()).toEqual({ state: 'disconnected' })
    await again.connect()
    expect(again.getStatus()).toEqual({ state: 'needs-passphrase', mode: 'unlock' })
  })

  it('cleans up settings from the old sign-in', async () => {
    await A.db.localMeta.bulkPut([
      { key: 'sync.clientId', value: 'x.apps.googleusercontent.com' },
      { key: 'sync.token', value: { token: 't', expiresAt: 0 } },
    ])
    await A.engine.init()
    expect(await A.db.localMeta.get('sync.clientId')).toBeUndefined()
    expect(await A.db.localMeta.get('sync.token')).toBeUndefined()
  })
})
