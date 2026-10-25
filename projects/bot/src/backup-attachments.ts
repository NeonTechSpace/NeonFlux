import type { Client, Message } from "@neontechspace/fluxerly/effect"
import { BACKUP_RESTORE_LIMITS } from "@neonflux/contracts/backup"
import { Data, Effect } from "effect"
import { backupPartLimit } from "./backup-crypto.ts"
import { readBackupContext } from "./backup-permissions.ts"
import { serverText } from "./server-scope.ts"

export class BackupAttachmentError extends Data.TaggedError("BackupAttachmentError")<{
    readonly reason: "identity" | "metadata" | "origin" | "size" | "transport"
}> {}
export interface BackupAttachmentInvocation {
    readonly serverId: string
    readonly message: Message
}
/** How long one part may take to download, which fetches a 4 MiB part over a slow link */
const PART_DOWNLOAD_MS = 30000
/**
 * Every part of an archive, attached to one DM message the owner sent: at most 10 files, each named and typed as NeonFlux sends a part. The
 * message is read again, and its attachments must be the ones it had. The parts come back in the message's order, and the archive puts them
 * in their own
 */
export function downloadBackupAttachments(client: Client, invocation: BackupAttachmentInvocation) {
    return Effect.gen(function* () {
        const message = invocation.message
        if (
            message.guildId !== undefined ||
            message.attachments.length < 1 ||
            message.attachments.length > BACKUP_RESTORE_LIMITS.parts
        )
            return yield* Effect.fail(new BackupAttachmentError({ reason: "identity" }))
        yield* readBackupContext(client, invocation.serverId, message.author.id, message.channelId)
        const current = yield* client.messages.fetch(
            { channelId: message.channelId, id: message.id },
            { timeoutMs: 5000 },
        )
        if (
            current.id !== message.id ||
            current.channelId !== message.channelId ||
            current.guildId !== undefined ||
            current.author.id !== message.author.id ||
            current.author.isBot ||
            current.author.isSystem ||
            current.webhookId ||
            current.attachments.length !== message.attachments.length
        )
            return yield* Effect.fail(new BackupAttachmentError({ reason: "identity" }))
        const instance = yield* client.instance.resolve({ timeoutMs: 5000 })
        for (const [i, attachment] of current.attachments.entries()) {
            const original = message.attachments[i]!
            if (
                attachment.id !== original.id ||
                attachment.filename !== original.filename ||
                attachment.size !== original.size ||
                attachment.contentType !== original.contentType
            )
                return yield* Effect.fail(new BackupAttachmentError({ reason: "identity" }))
            if (
                !/^neonflux-backup-[a-zA-Z0-9_-]{1,128}\.nfb$/.test(attachment.filename) ||
                attachment.contentType !== "application/octet-stream" ||
                !Number.isSafeInteger(attachment.size) ||
                attachment.size < 1 ||
                attachment.size > backupPartLimit ||
                attachment.expired === true
            )
                return yield* Effect.fail(new BackupAttachmentError({ reason: "metadata" }))
            yield* Effect.try({
                try: () => {
                    const base = new URL(instance.endpoints.media),
                        url = new URL(attachment.url ?? "")
                    const prefix = `${base.pathname.replace(/\/$/, "")}/attachments/`
                    const tail = url.pathname.slice(prefix.length).split("/")
                    if (
                        url.protocol !== "https:" ||
                        url.origin !== base.origin ||
                        url.username ||
                        url.password ||
                        url.hash ||
                        !url.pathname.startsWith(prefix) ||
                        tail.length !== 3 ||
                        tail[0] !== message.channelId ||
                        tail[1] !== attachment.id ||
                        decodeURIComponent(tail[2]!) !== attachment.filename
                    )
                        throw new Error()
                },
                catch: () => new BackupAttachmentError({ reason: "origin" }),
            })
        }
        const parts: Uint8Array[] = []
        for (const attachment of current.attachments) {
            // Refreshing a URL would not establish access. Recheck the owner and private audience before each part instead
            yield* readBackupContext(client, invocation.serverId, message.author.id, message.channelId)
            const bytes = yield* client.attachments.download(attachment, {
                maxBytes: backupPartLimit,
                timeoutMs: PART_DOWNLOAD_MS,
            })
            if (bytes.length !== attachment.size)
                return yield* Effect.fail(new BackupAttachmentError({ reason: "size" }))
            parts.push(bytes)
        }
        return parts
    }).pipe(
        Effect.mapError((error) =>
            error instanceof BackupAttachmentError ? error : new BackupAttachmentError({ reason: "transport" }),
        ),
    )
}
const keep = "Keep this file and the bot's backup key somewhere safe offline. Fluxer may not keep attachments forever"
/** The text and file name of one part, numbered when an archive has more than one, such as neonflux-backup-<id>-1of3.nfb */
export function backupPartMessage(backupId: string, partNo: number, partCount: number) {
    return partCount === 1
        ? { content: `Your encrypted backup. ${keep}`, filename: `neonflux-backup-${backupId}.nfb` }
        : {
              content: `Your encrypted backup, part ${partNo} of ${partCount}. Keep every part and the bot's backup key somewhere safe offline. Fluxer may not keep attachments forever. To restore, attach every part to one message`,
              filename: `neonflux-backup-${backupId}-${partNo}of${partCount}.nfb`,
          }
}
/** SDK byte upload, one DM message per part. check reads the private Owner evidence again right before each message */
export function uploadBackupAttachments<E>(
    client: Client,
    privateChannelId: string,
    parts: readonly Uint8Array[],
    backupId: string,
    check: Effect.Effect<unknown, E>,
    label?: string,
) {
    return Effect.gen(function* () {
        if (!parts.length || parts.some((bytes) => bytes.length < 1 || bytes.length > backupPartLimit))
            return yield* Effect.fail(new BackupAttachmentError({ reason: "size" }))
        for (const [i, data] of parts.entries()) {
            const { content, filename } = backupPartMessage(backupId, i + 1, parts.length)
            yield* check
            yield* client.messages
                .send(
                    privateChannelId,
                    {
                        content: label ? serverText(content, label) : content,
                        attachments: [{ filename, contentType: "application/octet-stream", data }],
                    },
                    { timeoutMs: 30000 },
                )
                .pipe(Effect.mapError(() => new BackupAttachmentError({ reason: "transport" })))
        }
    })
}
