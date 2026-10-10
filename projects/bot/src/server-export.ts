import type * as C from "@neonflux/backend/contracts"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import { readBackupContext } from "./backup-permissions.ts"
import type { BotConfig } from "./config.ts"
import { noMentions } from "./responses.ts"
import { serverCommands, serverReply } from "./server-scope.ts"
import type { ServerExportStore } from "./server-export-store.ts"

/** A large export arrives as several files of at most this size, each a complete file of the same format */
export const SERVER_EXPORT_PART_BYTES = 4 * 1024 * 1024
// The backend accepts owner evidence for a minute, so a long export reads it again before it gets that old
const EVIDENCE_MS = 45000
const help = [
    "!export sends this server's NeonFlux data to you as readable JSON: settings, leveling profiles, moderation cases and appeals",
    "Other bots can load it. It is separate from !backup, whose encrypted archive only restores into NeonFlux",
    "Only the server owner can export, in a one-to-one DM with NeonFlux, because the export holds private moderation data. The server's audit log records each export",
].join("\n")

// The bytes a value adds to the file, printed with two spaces per level at the depth it sits in the file
function bytes(value: unknown, depth: number) {
    const text = JSON.stringify(value, null, 2)
    return Buffer.byteLength(text) + text.split("\n").length * 2 * depth + 2
}
const records = (page: Exclude<C.ServerExportPage, { section: "settings" }>): unknown[] => page.section === "levels" ? page.levels : page.section === "showcases" ? page.showcases : page.section === "profiles" ? page.profiles : page.section === "cases" ? page.cases : page.appeals
function append(file: C.ServerExportFile, page: C.ServerExportPage) {
    if (page.section !== "settings") { (file[page.section] as unknown[]).push(...records(page)); return }
    const current = file.settings[page.family]
    if (!current) { file.settings[page.family] = page.data; return }
    // A later page of a family continues its lists
    for (const [key, value] of Object.entries(page.data)) current[key] = [...(current[key] as unknown[] ?? []), ...value as unknown[]]
}

/** Collects pages into file parts. add answers a full part to send before the page goes into the next one, and finish answers the last part */
export function serverExportParts(serverId: string, exportedAt: number, partBytes = SERVER_EXPORT_PART_BYTES) {
    const empty = (part: number): C.ServerExportFile => ({ format: "neonflux-server-export", version: 1, serverId, exportedAt, part, lastPart: false, settings: {}, levels: [], showcases: [], profiles: [], cases: [], appeals: [] })
    let file = empty(1), size = bytes(file, 0), filled = false
    return {
        add(page: C.ServerExportPage): C.ServerExportFile | undefined {
            const added = bytes(page.section === "settings" ? page.data : records(page), 2), full = filled && size + added > partBytes ? file : undefined
            if (full) { file = empty(full.part + 1); size = bytes(file, 0) }
            append(file, page)
            size += added; filled = true
            return full
        },
        finish: (): C.ServerExportFile => ({ ...file, lastPart: true }),
    }
}

/** !export in a verified one-to-one DM with the current server owner. Pages are read one at a time and each file part is sent once full */
export function handleServerExportCommand(store: ServerExportStore | undefined, config: BotConfig, args: readonly string[], context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        const { message, client } = context
        const selector = config.scope?.mode === "multi" ? ` --server ${config.serverId}` : ""
        if (message.guildId !== undefined) {
            if (message.guildId === config.serverId) yield* context.reply({ content: `Use !export${selector} in a one-to-one DM with NeonFlux. Only the server owner can export the server's data`, allowedMentions: noMentions })
            return
        }
        if (message.author.isBot || message.author.isSystem || message.webhookId) return
        // A member who is not the current owner gets no answer, like !backup
        const owner = yield* readBackupContext(client, config.serverId, message.author.id, message.channelId).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!owner) return
        let evidence = owner
        const send = (content: string, file?: { name: string, data: string }) => client.messages.send(message.channelId, {
            content: config.scope?.mode === "multi" ? serverReply(content, config.serverId) : content, allowedMentions: noMentions,
            ...(file ? { attachments: [{ filename: file.name, contentType: "application/json", data: new TextEncoder().encode(file.data) }] } : {}) }, { timeoutMs: 5000 })
        if (args.length === 1 && args[0]!.toLowerCase() === "help") { yield* send(serverCommands(help, config)); return }
        if (args.length) { yield* send(serverCommands("Use !export to export this server's data, or !export help", config)); return }
        if (!store) { yield* send("Server export is not available because the backend is not configured"); return }
        const fresh = Effect.gen(function* () {
            if ((yield* Clock.currentTimeMillis) - evidence.observedAt >= EVIDENCE_MS) evidence = yield* readBackupContext(client, config.serverId, message.author.id, message.channelId)
            return evidence
        })
        const run = Effect.gen(function* () {
            yield* store.start({ serverId: config.serverId, context: evidence })
            const parts = serverExportParts(config.serverId, yield* Clock.currentTimeMillis)
            const deliver = (file: C.ServerExportFile) => Effect.gen(function* () {
                // The owner and the private conversation are read again right before private data leaves
                yield* readBackupContext(client, config.serverId, message.author.id, message.channelId)
                const single = file.lastPart && file.part === 1
                yield* send(single ? "This server's NeonFlux data as readable JSON. The export guide in the NeonFlux documentation describes every field"
                    : `Part ${file.part} of this server's NeonFlux data${file.lastPart ? ", the last part" : ". More parts follow"}`,
                { name: `neonflux-server-export-${config.serverId}${single ? "" : `-part-${file.part}`}.json`, data: JSON.stringify(file, null, 2) })
            })
            let cursor: string | null = null
            do {
                const page: C.ServerExportPage = yield* store.page({ serverId: config.serverId, context: yield* fresh, cursor })
                const full = parts.add(page)
                if (full) yield* deliver(full)
                cursor = page.cursor
            } while (cursor)
            yield* deliver(parts.finish())
        })
        yield* run.pipe(Effect.catch(() => send("The export could not be completed. Check that you still own the server and try again shortly")))
    })
}
