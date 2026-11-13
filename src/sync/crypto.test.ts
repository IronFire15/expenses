import { describe, expect, it } from 'vitest'
import { decrypt, deriveKey, encrypt, fromBase64, passphraseStrength, randomSalt, readEnvelope, toBase64, WrongPassphraseError } from './crypto'

const FAST = 1000 // real files use 600 000 iterations; tests don't need to wait for that

describe('crypto', () => {
  it('round-trips data and hides the plaintext', async () => {
    const salt = randomSalt()
    const key = await deriveKey('correct horse battery staple', salt, FAST)
    const data = { hello: 'Olá €', n: [1, 2, 3], big: 'x'.repeat(100_000) }
    const text = await encrypt(data, key, salt, FAST)
    expect(text).not.toContain('Olá')
    expect(text.length).toBeLessThan(10_000) // gzip before encrypt
    expect(await decrypt(text, key)).toEqual(data)
  })

  it('stores salt and iterations so another device can derive the same key', async () => {
    const salt = randomSalt()
    const text = await encrypt({ a: 1 }, await deriveKey('pw-123456789', salt, FAST), salt, FAST)
    const env = readEnvelope(text)
    const again = await deriveKey('pw-123456789', fromBase64(env.kdf.salt), env.kdf.iterations)
    expect(await decrypt(text, again)).toEqual({ a: 1 })
  })

  it('rejects a wrong passphrase and tampered data', async () => {
    const salt = randomSalt()
    const text = await encrypt({ a: 1 }, await deriveKey('right passphrase', salt, FAST), salt, FAST)
    await expect(decrypt(text, await deriveKey('wrong passphrase', salt, FAST))).rejects.toBeInstanceOf(WrongPassphraseError)

    const env = JSON.parse(text)
    const bytes = fromBase64(env.data)
    bytes[0] ^= 1
    const tampered = JSON.stringify({ ...env, data: toBase64(bytes) })
    await expect(decrypt(tampered, await deriveKey('right passphrase', salt, FAST))).rejects.toBeInstanceOf(WrongPassphraseError)
  })

  it('uses a new IV for every upload', async () => {
    const salt = randomSalt()
    const key = await deriveKey('same', salt, FAST)
    const a = readEnvelope(await encrypt({}, key, salt, FAST))
    const b = readEnvelope(await encrypt({}, key, salt, FAST))
    expect(a.cipher.iv).not.toBe(b.cipher.iv)
  })

  it('rates passphrases mostly by length', () => {
    expect(passphraseStrength('abc').score).toBe(0)
    expect(passphraseStrength('abcdefghijkl').score).toBe(2)
    expect(passphraseStrength('four random words here').score).toBe(3)
  })
})
