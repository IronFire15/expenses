/**
 * Google Drive storage for the sync file, via the Drive REST API v3.
 *
 * Scope `drive.file`: the app can only see files it created itself, never the rest of your Drive.
 * Layout in your Drive:  My Drive / Expenses / expenses-sync.json.enc
 *                        My Drive / Expenses / backups / expenses-2026-11-13.json.enc
 */

const FOLDER = 'Expenses'
const BACKUPS = 'backups'
export const SYNC_FILE = 'expenses-sync.json.enc'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const FILE_MIME = 'application/octet-stream'

export interface RemoteFile {
  id: string
  /** Drive increments this on every change: used to detect another device writing meanwhile. */
  version: string
}

export interface BackupFile {
  id: string
  name: string
  createdTime: string
}

/** What the sync engine needs from storage. Google Drive in the app, an in-memory fake in tests. */
export interface DriveApi {
  findSyncFile(): Promise<RemoteFile | null>
  download(id: string): Promise<string>
  create(content: string): Promise<RemoteFile>
  /** Overwrite only if the file is still at `expectedVersion`; otherwise throws ConflictError. */
  update(id: string, content: string, expectedVersion: string): Promise<RemoteFile>
  writeBackup(name: string, content: string): Promise<void>
  listBackups(): Promise<BackupFile[]>
  deleteFile(id: string): Promise<void>
  /** Delete every earlier version Drive keeps of a file, leaving only the current one. */
  deleteOldRevisions(id: string): Promise<void>
}

export class ConflictError extends Error {
  constructor() {
    super('Another device changed the sync file at the same time.')
    this.name = 'ConflictError'
  }
}

/** Signed out, or Google revoked access: the user has to sign in again. */
export class NeedsAuthError extends Error {
  constructor() {
    super('Sign in to Google again to keep syncing.')
    this.name = 'NeedsAuthError'
  }
}

/** Where Drive gets its access tokens: the signed-in Google account (see account.ts). */
export interface TokenSource {
  token(): Promise<string>
  forget(): void
}

// ---------- Drive REST client ----------

export class GoogleDrive implements DriveApi {
  private folderId: string | null = null
  private backupsId: string | null = null
  private auth: TokenSource

  constructor(auth: TokenSource) {
    this.auth = auth
  }

  private async call(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await this.auth.token()}` } })
    if (res.status === 401) {
      // The cached token may have just expired: get a fresh one once before giving up.
      this.auth.forget()
      if (!retried) return this.call(url, init, true)
      throw new NeedsAuthError()
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Google Drive error ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
    }
    return res
  }

  private async find(name: string, parent: string | null, mime?: string): Promise<{ id: string; version: string } | null> {
    const q = [`name = '${name.replace(/'/g, "\\'")}'`, 'trashed = false', parent ? `'${parent}' in parents` : null, mime ? `mimeType = '${mime}'` : null]
      .filter(Boolean)
      .join(' and ')
    const res = await this.call(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: 'files(id,version)', spaces: 'drive', orderBy: 'modifiedTime desc' })}`)
    const { files } = (await res.json()) as { files: { id: string; version: string }[] }
    return files[0] ?? null
  }

  private async folder(name: string, parent: string | null): Promise<string> {
    const found = await this.find(name, parent, FOLDER_MIME)
    if (found) return found.id
    const res = await this.call('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) }),
    })
    return ((await res.json()) as { id: string }).id
  }

  private async root(): Promise<string> {
    this.folderId ??= await this.folder(FOLDER, null)
    return this.folderId
  }

  private multipart(meta: object, content: string): { body: Blob; type: string } {
    const boundary = `expenses-${crypto.randomUUID()}`
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${FILE_MIME}\r\n\r\n`,
      content,
      `\r\n--${boundary}--`,
    ])
    return { body, type: `multipart/related; boundary=${boundary}` }
  }

  async findSyncFile() {
    return this.find(SYNC_FILE, await this.root())
  }

  async download(id: string) {
    return (await this.call(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).text()
  }

  async create(content: string) {
    const { body, type } = this.multipart({ name: SYNC_FILE, parents: [await this.root()], mimeType: FILE_MIME }, content)
    const res = await this.call('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version', {
      method: 'POST',
      headers: { 'Content-Type': type },
      body,
    })
    return (await res.json()) as RemoteFile
  }

  async update(id: string, content: string, expectedVersion: string) {
    // Drive has no conditional write, so check the version right before writing.
    // The remaining race window is a few hundred ms; the next sync merges anything it missed.
    const meta = (await (await this.call(`https://www.googleapis.com/drive/v3/files/${id}?fields=version`)).json()) as { version: string }
    if (meta.version !== expectedVersion) throw new ConflictError()
    const { body, type } = this.multipart({}, content)
    const res = await this.call(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart&fields=id,version`, {
      method: 'PATCH',
      headers: { 'Content-Type': type },
      body,
    })
    return (await res.json()) as RemoteFile
  }

  private async backupsFolder() {
    this.backupsId ??= await this.folder(BACKUPS, await this.root())
    return this.backupsId
  }

  async writeBackup(name: string, content: string) {
    const { body, type } = this.multipart({ name, parents: [await this.backupsFolder()], mimeType: FILE_MIME }, content)
    await this.call('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': type }, body })
  }

  async listBackups() {
    const q = `'${await this.backupsFolder()}' in parents and trashed = false`
    const res = await this.call(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: 'files(id,name,createdTime)', orderBy: 'createdTime desc', pageSize: '100' })}`)
    return ((await res.json()) as { files: BackupFile[] }).files
  }

  async deleteFile(id: string) {
    await this.call(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' })
  }

  async deleteOldRevisions(id: string) {
    const res = await this.call(`https://www.googleapis.com/drive/v3/files/${id}/revisions?${new URLSearchParams({ fields: 'revisions(id)', pageSize: '1000' })}`)
    const { revisions } = (await res.json()) as { revisions: { id: string }[] }
    // Listed oldest first; the last one is the current content and can't be deleted.
    for (const r of revisions.slice(0, -1)) await this.call(`https://www.googleapis.com/drive/v3/files/${id}/revisions/${r.id}`, { method: 'DELETE' })
  }
}
