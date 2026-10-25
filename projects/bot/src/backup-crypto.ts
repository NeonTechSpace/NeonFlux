import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { Data, Redacted } from "effect"
import { BACKUP_RESTORE_LIMITS } from "@neonflux/contracts/backup"

export type BackupKey = Redacted.Redacted<Uint8Array>
/**
 * version is an archive of an older format, which a restore no longer reads, and parts an archive whose parts are not all there, or come from
 * more than one archive. partCount is how many parts the archive has, as its parts say
 */
export class BackupCryptoError extends Data.TaggedError("BackupCryptoError")<{
    readonly reason: "configuration" | "envelope" | "authentication" | "manifest" | "size" | "version" | "parts"
    readonly partCount?: number
}> {}
/**
 * A part: version byte 2, the archive's 16-byte ID, the part's number and the number of parts as two big-endian 16-bit integers, a 12-byte
 * nonce, a 16-byte tag, then AES-256-GCM ciphertext of the part's share of the manifest's JSON. The first 21 bytes are the additional data,
 * so a part cannot be swapped, reordered or mixed with a part of another archive
 */
const VERSION = 2,
    HEADER = 21,
    ENVELOPE = HEADER + 12 + 16
export const backupPartLimit = BACKUP_RESTORE_LIMITS.partBytes
export function parseBackupKey(environment: Readonly<NodeJS.ProcessEnv>): BackupKey | undefined {
    const encoded = environment.NEONFLUX_BACKUP_KEY?.trim()
    if (!encoded) return undefined
    const bytes = Buffer.from(encoded, "base64")
    // Recovery material is independently provisioned, never copied from either authentication secret
    if (
        bytes.length !== 32 ||
        bytes.toString("base64") !== encoded ||
        [environment.FLUXER_BOT_TOKEN?.trim(), environment.NEONFLUX_BOT_API_SECRET?.trim()].includes(encoded)
    )
        throw new BackupCryptoError({ reason: "configuration" })
    return Redacted.make(new Uint8Array(bytes))
}
/** The caller supplies a validated manifest. No plaintext leaves memory. partBytes is the most one part may hold, smaller only in tests */
export function encryptBackupManifest<M extends { readonly backupId: string }>(
    manifest: M,
    key: BackupKey,
    partBytes: number = backupPartLimit,
): Uint8Array[] {
    const plaintext = Buffer.from(JSON.stringify(manifest), "utf8")
    try {
        const share = partBytes - ENVELOPE,
            count = Math.max(1, Math.ceil(plaintext.length / share)),
            id = Buffer.from(manifest.backupId, "hex")
        if (plaintext.length > BACKUP_RESTORE_LIMITS.plaintextBytes || count > BACKUP_RESTORE_LIMITS.parts)
            throw new BackupCryptoError({ reason: "size" })
        if (id.length !== 16) throw new BackupCryptoError({ reason: "manifest" })
        return Array.from({ length: count }, (_, i) => {
            const header = Buffer.alloc(HEADER)
            header[0] = VERSION
            id.copy(header, 1)
            header.writeUInt16BE(i + 1, 17)
            header.writeUInt16BE(count, 19)
            const nonce = randomBytes(12),
                cipher = createCipheriv("aes-256-gcm", Redacted.value(key), nonce, { authTagLength: 16 })
            cipher.setAAD(header)
            const ciphertext = Buffer.concat([
                cipher.update(plaintext.subarray(i * share, (i + 1) * share)),
                cipher.final(),
            ])
            return Buffer.concat([header, nonce, cipher.getAuthTag(), ciphertext])
        })
    } finally {
        plaintext.fill(0)
    }
}
/** How many parts the archive of this part has, or undefined for a file that is not a part */
export const backupPartCount = (part: Uint8Array) =>
    part.length >= ENVELOPE && part[0] === VERSION ? Buffer.from(part).readUInt16BE(19) : undefined
/**
 * Every part of one archive, in any order, decrypted and joined. Each part is authenticated with its header before the JSON parser sees any
 * plaintext, and the buffers are zeroed after. Answers the manifest and the parts in their order, which the archive's digest hashes
 */
export function decryptBackupParts(
    parts: readonly Uint8Array[],
    key: BackupKey,
): { manifest: unknown; parts: Uint8Array[] } {
    if (parts.some((part) => part.length >= 1 && part[0] === 1)) throw new BackupCryptoError({ reason: "version" })
    if (parts.some((part) => part.length > backupPartLimit)) throw new BackupCryptoError({ reason: "size" })
    if (!parts.length || parts.some((part) => part.length < ENVELOPE || part[0] !== VERSION))
        throw new BackupCryptoError({ reason: "envelope" })
    const read = parts.map((part) => {
        const bytes = Buffer.from(part)
        return { bytes, id: bytes.subarray(1, 17), no: bytes.readUInt16BE(17), count: bytes.readUInt16BE(19) }
    })
    const count = read[0]!.count
    if (
        read.length !== count ||
        read.some((part) => part.count !== count || !part.id.equals(read[0]!.id)) ||
        new Set(read.map((part) => part.no)).size !== count ||
        read.some((part) => part.no < 1 || part.no > count)
    )
        throw new BackupCryptoError({ reason: "parts", partCount: count })
    read.sort((a, b) => a.no - b.no)
    const plain: Buffer[] = []
    try {
        for (const part of read) {
            const decipher = createDecipheriv(
                "aes-256-gcm",
                Redacted.value(key),
                part.bytes.subarray(HEADER, HEADER + 12),
                {
                    authTagLength: 16,
                },
            )
            decipher.setAAD(part.bytes.subarray(0, HEADER))
            decipher.setAuthTag(part.bytes.subarray(HEADER + 12, ENVELOPE))
            try {
                plain.push(Buffer.concat([decipher.update(part.bytes.subarray(ENVELOPE)), decipher.final()]))
            } catch {
                throw new BackupCryptoError({ reason: "authentication" })
            }
        }
        const joined = Buffer.concat(plain)
        plain.push(joined)
        if (joined.length > BACKUP_RESTORE_LIMITS.plaintextBytes) throw new BackupCryptoError({ reason: "size" })
        let manifest: unknown
        try {
            manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined))
        } catch {
            throw new BackupCryptoError({ reason: "manifest" })
        }
        // The manifest names the archive its parts say they belong to
        if ((manifest as { backupId?: unknown } | null)?.backupId !== read[0]!.id.toString("hex"))
            throw new BackupCryptoError({ reason: "manifest" })
        return { manifest, parts: read.map((part) => new Uint8Array(part.bytes)) }
    } finally {
        for (const buffer of plain) buffer.fill(0)
    }
}
/** The SHA-256 of every part's bytes in their order, which binds a restore plan to the archive */
export function backupArchiveDigest(parts: readonly Uint8Array[]) {
    const hash = createHash("sha256")
    for (const part of parts) hash.update(part)
    return hash.digest("hex")
}
