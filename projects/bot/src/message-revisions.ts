import type { Client, Message } from "@neontechspace/fluxerly/effect"
import { METADATA_TEXT, metadataSlice } from "@neonflux/contracts/metadata-logs"

// Link previews arrive as message updates that repeat everything else. Features read an update only for an edit, a pin
// change or a flag change, so an update whose edit time, pin status and flags all match the last observation is skipped.
// Absent values mean unknown and never match, and a message outside the bounded memory is always processed.
// Fluxer sends an edited message without its earlier text, so metadata logs show the text this memory kept. It keeps a
// server message's text, author and attachments only while that server posts message events to a log channel, and never
// a DM's
const revision = (message: Pick<Message, "editedAt" | "pinned" | "flags">) =>
    message.editedAt === undefined || message.pinned === undefined || message.flags === undefined
        ? undefined
        : `${message.editedAt ?? ""}|${message.pinned}|${message.flags}`

/** Text and attachment names are kept up to these sizes, which a log post can show */
export const MESSAGE_TEXT_LIMIT = METADATA_TEXT,
    MESSAGE_ATTACHMENT_LIMIT = 10
const messageRevisionLimit = 10000,
    // Two bytes per UTF-16 unit of kept text, attachment names and links
    messageTextBytes = 8388608

export interface RememberedAttachment {
    readonly name: string
    readonly size: number
    readonly url?: string
}
/** What the memory knew of a message. text is absent when it was not kept */
export interface RememberedMessage {
    readonly editedAt?: string | null
    readonly pinned?: boolean
    readonly flags?: number
    readonly guildId?: string
    readonly authorId?: string
    readonly authorBot?: boolean
    readonly text?: string
    readonly attachments?: readonly RememberedAttachment[]
    readonly attachmentCount?: number
}
interface Entry extends RememberedMessage {
    readonly revision: string | undefined
    readonly bytes: number
}

const attachmentsOf = (message: Message) =>
    message.attachments.slice(0, MESSAGE_ATTACHMENT_LIMIT).map((a): RememberedAttachment => ({
        name: a.filename.slice(0, 256) || "file",
        size: Number.isSafeInteger(a.size) && a.size >= 0 ? a.size : 0,
        ...(a.url && a.url.length <= 512 && a.url.startsWith("https://") ? { url: a.url } : {}),
    }))

/** Recent messages, shared by every server of the process */
export function createMessageRevisions(limit = messageRevisionLimit, textBytes = messageTextBytes) {
    const seen = new Map<string, Entry>(),
        // The IDs of each server's messages, so forgetting one server reads only its own
        byServer = new Map<string, Set<string>>()
    // The servers whose message events reach a log channel, which the backend's answers report
    const keeping = new Set<string>()
    // Messages of bots, webhooks and the system, which logs leave out. A deletion names no author flags, so this is how
    // it is known to be one of theirs. Only the IDs are kept, up to the same count as the messages
    const excluded = new Set<string>()
    // Other bots, webhooks and the system keep only their IDs, never their text
    const other = (message: Message) => message.author.isBot || message.author.isSystem || !!message.webhookId
    const exclude = (message: Message) => {
        if (!other(message)) return
        excluded.delete(message.id)
        excluded.add(message.id)
        if (excluded.size > limit) excluded.delete(excluded.keys().next().value!)
    }
    let bytes = 0
    const drop = (id: string) => {
        const old = seen.get(id)
        if (old) {
            bytes -= old.bytes
            seen.delete(id)
            const ids = old.guildId === undefined ? undefined : byServer.get(old.guildId)
            ids?.delete(id)
            if (ids && !ids.size) byServer.delete(old.guildId!)
        }
        return old
    }
    const remember = (message: Message) => {
        exclude(message)
        const old = drop(message.id),
            value = revision(message),
            guildId = message.guildId ?? old?.guildId,
            kept = guildId !== undefined && keeping.has(guildId) && !other(message)
        if (value === undefined && !kept) return old
        const attachments = kept ? attachmentsOf(message) : []
        const entry: Entry = {
            revision: value,
            ...(message.editedAt !== undefined ? { editedAt: message.editedAt } : {}),
            ...(message.pinned !== undefined ? { pinned: message.pinned } : {}),
            ...(message.flags !== undefined ? { flags: message.flags } : {}),
            ...(kept
                ? {
                      guildId,
                      authorId: message.author.id,
                      authorBot: message.author.isBot,
                      text: metadataSlice(message.content, MESSAGE_TEXT_LIMIT),
                      ...(attachments.length ? { attachments } : {}),
                      ...(message.attachments.length > attachments.length
                          ? { attachmentCount: message.attachments.length }
                          : {}),
                  }
                : guildId !== undefined
                  ? { guildId }
                  : {}),
            bytes: kept
                ? 2 *
                  (Math.min(message.content.length, MESSAGE_TEXT_LIMIT) +
                      attachments.reduce((n, a) => n + a.name.length + (a.url?.length ?? 0), 0))
                : 0,
        }
        seen.set(message.id, entry)
        if (guildId !== undefined) {
            let ids = byServer.get(guildId)
            if (!ids) byServer.set(guildId, (ids = new Set()))
            ids.add(message.id)
        }
        bytes += entry.bytes
        // The oldest entries go first, until both limits hold
        while (seen.size > limit || bytes > textBytes) drop(seen.keys().next().value!)
        return old
    }
    const forgetServer = (guildId: string) => {
        for (const id of [...(byServer.get(guildId) ?? [])]) drop(id)
    }
    return {
        created: (message: Message) => void remember(message),
        /** Records the update, reports whether a feature could need it and returns what the memory knew before */
        changed: (message: Message) => {
            const before = remember(message),
                after = revision(message)
            return { needed: after === undefined || before?.revision !== after, previous: before as RememberedMessage }
        },
        /** Notes a message of a bot, a webhook or the system that the router does not otherwise remember */
        observed: exclude,
        /** Removes a deleted message and returns what the memory knew of it */
        deleted: (id: string): RememberedMessage | undefined => {
            const old = drop(id)
            return excluded.delete(id) ? { ...old, authorBot: true } : old
        },
        /** Starts or stops keeping a server's message text, and forgets the text it kept when it stops */
        keepText: (guildId: string, keep: boolean) => {
            if (keep) keeping.add(guildId)
            else if (keeping.delete(guildId)) forgetServer(guildId)
        },
        /** Forgets a server's messages, as when the bot may have missed its edits */
        forgetServer,
        /** Forgets the messages of servers a lost shard connection may have missed edits of */
        forgetWhere: (forgotten: (guildId: string) => boolean) => {
            for (const guildId of [...byServer.keys()]) if (forgotten(guildId)) forgetServer(guildId)
        },
    }
}
export type MessageRevisions = ReturnType<typeof createMessageRevisions>

const memories = new WeakMap<Client, MessageRevisions>()
/** The one message memory of a client, which the router and every server's handlers share */
export function messageRevisionsOf(client: Client) {
    let memory = memories.get(client)
    if (!memory) memories.set(client, (memory = createMessageRevisions()))
    return memory
}

// What the memory knew of an edited message, carried from the router to the server's handler with the routed event
const earlier = new WeakMap<object, RememberedMessage | undefined>()
export const carryEarlierMessage = (event: object, previous: RememberedMessage | undefined) =>
    void earlier.set(event, previous)
export const earlierMessageOf = (event: object) => earlier.get(event)
