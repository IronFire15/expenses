/**
 * Encryption for the Drive file. Google only ever sees ciphertext.
 *
 * - Key: PBKDF2-SHA256 from your passphrase + a random salt (600 000 iterations, OWASP 2023 guidance).
 * - Cipher: AES-256-GCM with a fresh random 12-byte IV per upload. GCM also detects tampering
 *   and wrong passphrases (decryption fails instead of returning garbage).
 * - Payload: JSON, gzipped before encryption.
 */

export const DEFAULT_ITERATIONS = 600_000
const AAD = new TextEncoder().encode('expenses-sync-v1')

export interface Envelope {
  format: 'expenses-sync'
  v: 1
  kdf: { name: 'PBKDF2-SHA256'; salt: string; iterations: number }
  cipher: { name: 'AES-GCM'; iv: string }
  data: string
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase, or the sync file was changed outside the app.')
    this.name = 'WrongPassphraseError'
  }
}

// ---------- base64 (chunked: large arrays overflow String.fromCharCode(...)) ----------

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

// ---------- gzip ----------

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer())
}
const gzip = (b: Uint8Array<ArrayBuffer>) => pipe(b, new CompressionStream('gzip'))
const gunzip = (b: Uint8Array<ArrayBuffer>) => pipe(b, new DecompressionStream('gzip'))

// ---------- keys ----------

export function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(16))
}

/** Non-extractable key: it can encrypt/decrypt but can never be read back out, even by this app. */
export async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations = DEFAULT_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

// ---------- envelope ----------

export async function encrypt(value: unknown, key: CryptoKey, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = await gzip(new TextEncoder().encode(JSON.stringify(value)))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, plain))
  const env: Envelope = {
    format: 'expenses-sync',
    v: 1,
    kdf: { name: 'PBKDF2-SHA256', salt: toBase64(salt), iterations },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(cipher),
  }
  return JSON.stringify(env)
}

/** Read the (unencrypted) header: which salt and iteration count the key needs. */
export function readEnvelope(text: string): Envelope {
  const env = JSON.parse(text) as Envelope
  if (env?.format !== 'expenses-sync' || env.v !== 1) throw new Error('This is not an Expenses sync file.')
  return env
}

export async function decrypt<T>(text: string, key: CryptoKey): Promise<T> {
  const env = readEnvelope(text)
  let plain: Uint8Array<ArrayBuffer>
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(env.cipher.iv), additionalData: AAD }, key, fromBase64(env.data)),
    )
  } catch {
    throw new WrongPassphraseError()
  }
  return JSON.parse(new TextDecoder().decode(await gunzip(plain))) as T
}

/** Rough passphrase strength for the UI. Length matters most. */
export function passphraseStrength(p: string): { score: 0 | 1 | 2 | 3; label: string } {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length
  const words = p.trim().split(/\s+/).length
  if (p.length >= 20 || (p.length >= 14 && (classes >= 3 || words >= 4))) return { score: 3, label: 'Strong' }
  if (p.length >= 12) return { score: 2, label: 'Good' }
  if (p.length >= 8) return { score: 1, label: 'Weak' }
  return { score: 0, label: 'Too short' }
}
