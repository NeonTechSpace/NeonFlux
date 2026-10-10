import type { Client, Message } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import { backupEnvelopeLimit } from "./backup-crypto.ts"
import { readBackupContext } from "./backup-permissions.ts"
import { noMentions } from "./responses.ts"

export class BackupAttachmentError extends Data.TaggedError("BackupAttachmentError")<{ readonly reason: "identity" | "metadata" | "origin" | "size" | "transport" }> {}
export interface BackupAttachmentInvocation {
    readonly serverId: string
    readonly message: Message
}
export function downloadBackupAttachment(client: Client, invocation: BackupAttachmentInvocation) {
    return Effect.gen(function* () {
        const message = invocation.message
        if (message.guildId !== undefined || message.attachments.length !== 1) return yield* Effect.fail(new BackupAttachmentError({ reason: "identity" }))
        yield* readBackupContext(client, invocation.serverId, message.author.id, message.channelId)
        const current = yield* client.messages.fetch({ channelId: message.channelId, id: message.id }, { timeoutMs: 5000 })
        if (current.id !== message.id || current.channelId !== message.channelId || current.guildId !== undefined || current.author.id !== message.author.id
            || current.author.isBot || current.author.isSystem || current.webhookId || current.attachments.length !== 1) return yield* Effect.fail(new BackupAttachmentError({ reason: "identity" }))
        const attachment = current.attachments[0]!, original = message.attachments[0]!
        if (attachment.id !== original.id || attachment.filename !== original.filename || attachment.size !== original.size || attachment.contentType !== original.contentType) return yield* Effect.fail(new BackupAttachmentError({ reason: "identity" }))
        if (!/^neonflux-backup-[a-zA-Z0-9_-]{1,128}\.nfb$/.test(attachment.filename) || attachment.contentType !== "application/octet-stream"
            || !Number.isSafeInteger(attachment.size) || attachment.size < 1 || attachment.size > backupEnvelopeLimit || attachment.expired === true) return yield* Effect.fail(new BackupAttachmentError({ reason: "metadata" }))
        const instance = yield* client.instance.resolve({ timeoutMs: 5000 })
        yield* Effect.try({ try: () => {
            const base = new URL(instance.endpoints.media), url = new URL(attachment.url ?? "")
            const prefix = `${base.pathname.replace(/\/$/, "")}/attachments/`
            const tail = url.pathname.slice(prefix.length).split("/")
            if (url.protocol !== "https:" || url.origin !== base.origin || url.username || url.password || url.hash || !url.pathname.startsWith(prefix)
                || tail.length !== 3 || tail[0] !== message.channelId || tail[1] !== attachment.id || decodeURIComponent(tail[2]!) !== attachment.filename) throw new Error()
        }, catch: () => new BackupAttachmentError({ reason: "origin" }) })
        // Refreshing a URL would not establish access. Recheck the owner and private audience instead
        yield* readBackupContext(client, invocation.serverId, message.author.id, message.channelId)
        const bytes = yield* client.attachments.download(attachment, { maxBytes: backupEnvelopeLimit, timeoutMs: 5000 })
        if (bytes.length !== attachment.size) return yield* Effect.fail(new BackupAttachmentError({ reason: "size" }))
        return bytes
    }).pipe(Effect.mapError(error => error instanceof BackupAttachmentError ? error : new BackupAttachmentError({ reason: "transport" })))
}
/** SDK byte upload. Callers must refresh private Owner evidence immediately before invoking */
export function uploadBackupAttachment(client: Client, privateChannelId: string, bytes: Uint8Array) {
    return Effect.gen(function* () {
        if (bytes.length < 1 || bytes.length > backupEnvelopeLimit) return yield* Effect.fail(new BackupAttachmentError({ reason: "size" }))
        return yield* client.messages.send(privateChannelId, { content: "Your encrypted backup. Keep this file and the bot's backup key somewhere safe offline. Fluxer may not keep attachments forever",
            allowedMentions: noMentions, attachments: [{ filename: "neonflux-backup-archive.nfb", contentType: "application/octet-stream", data: bytes }] }, { timeoutMs: 5000 })
    }).pipe(Effect.mapError(error => error instanceof BackupAttachmentError ? error : new BackupAttachmentError({ reason: "transport" })))
}
