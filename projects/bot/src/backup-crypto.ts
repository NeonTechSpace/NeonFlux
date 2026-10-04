import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { Data, Redacted } from "effect"

export const backupPlaintextLimit = 4 * 1024 * 1024
export const backupEnvelopeLimit = backupPlaintextLimit + 29
export type BackupKey = Redacted.Redacted<Uint8Array>
export class BackupCryptoError extends Data.TaggedError("BackupCryptoError")<{ readonly reason: "configuration" | "envelope" | "authentication" | "manifest" | "size" }> {}
// Envelope: version byte, 12-byte nonce, 16-byte tag, then AES-256-GCM ciphertext. The version byte is authenticated
const version = Buffer.from([1])
export function parseBackupKey(environment: Readonly<NodeJS.ProcessEnv>): BackupKey | undefined {
    const encoded = environment.NEONFLUX_BACKUP_KEY?.trim()
    if (!encoded) return undefined
    const bytes = Buffer.from(encoded, "base64")
    // Recovery material is independently provisioned, never copied from either authentication secret
    if (bytes.length !== 32 || bytes.toString("base64") !== encoded
        || [environment.FLUXER_BOT_TOKEN?.trim(), environment.NEONFLUX_BOT_API_SECRET?.trim()].includes(encoded)) throw new BackupCryptoError({ reason: "configuration" })
    return Redacted.make(new Uint8Array(bytes))
}
/** The caller supplies a validated manifest. No plaintext leaves memory */
export function encryptBackupManifest(manifest: unknown, key: BackupKey): Uint8Array {
    const plaintext = Buffer.from(JSON.stringify(manifest), "utf8")
    try {
        if (plaintext.length > backupPlaintextLimit) throw new BackupCryptoError({ reason: "size" })
        const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Redacted.value(key), nonce, { authTagLength: 16 })
        cipher.setAAD(version)
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
        return Buffer.concat([version, nonce, cipher.getAuthTag(), ciphertext])
    } finally { plaintext.fill(0) }
}
/** Authentication completes before the JSON parser sees plaintext */
export function decryptBackupEnvelope(bytes: Uint8Array, key: BackupKey): unknown {
    if (bytes.length > backupEnvelopeLimit) throw new BackupCryptoError({ reason: "size" })
    if (bytes.length < 29 || bytes[0] !== version[0]) throw new BackupCryptoError({ reason: "envelope" })
    const envelope = Buffer.from(bytes), decipher = createDecipheriv("aes-256-gcm", Redacted.value(key), envelope.subarray(1, 13), { authTagLength: 16 })
    decipher.setAAD(version); decipher.setAuthTag(envelope.subarray(13, 29))
    let plaintext: Buffer
    try { plaintext = Buffer.concat([decipher.update(envelope.subarray(29)), decipher.final()]) }
    catch { throw new BackupCryptoError({ reason: "authentication" }) }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) }
    catch { throw new BackupCryptoError({ reason: "manifest" }) }
    finally { plaintext.fill(0) }
}
