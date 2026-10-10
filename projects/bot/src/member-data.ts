import type * as C from "@neonflux/backend/contracts"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { memberDataHelp, parseMemberDataCommand } from "./member-data-command.ts"
import type { MemberDataStore } from "./member-data-store.ts"
import { noMentions } from "./responses.ts"
import { verifyPrivateAuthor } from "./safety-permissions.ts"

// One request reads or deletes at most this many pages, so a member with a lot of data continues with another request.
// An export searches for servers in at most SERVER_CALLS calls of up to 200 index reads each
const EXPORT_PAGES = 50, SERVER_CALLS = 20, DELETE_CALLS = 20, REPLY_LIMIT = 1900
const SECURITY_NOTE = "Security records, such as spam detection counts, watchlist entries and verification links, are kept under their own expiry and are not listed"

const lines = (items: string[]) => {
    const kept: string[] = []
    for (const item of items) { if ([...kept, item].join("\n").length > REPLY_LIMIT) { kept.push("…and more. Use !mydata export for everything"); break } kept.push(item) }
    return kept.join("\n")
}
const feature = (item: C.MemberDataFeatureCount, complete: boolean) => `- ${item.feature}: ${item.count}${!complete && item.count >= 50 ? " or more" : ""}${item.kept ? `, kept: ${item.kept}` : ""}`

/** !mydata in a verified one-to-one conversation with the bot. Lists, exports or deletes what NeonFlux stores about the author */
export function handleMemberDataCommand(store: MemberDataStore | undefined, context: BotEventContext<"messageCreate">) {
    const { message, client } = context, userId = message.author.id
    const respond = (content: string) => context.reply({ content, allowedMentions: noMentions })
    return Effect.gen(function* () {
        // Only the author's own private conversation may read or delete their data
        if (!(yield* verifyPrivateAuthor(client, message.channelId, userId).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false))))) return
        if (!store) { yield* respond("Member data requests are not available because the backend is not configured"); return }
        const command = parseMemberDataCommand(message.content)
        if ("error" in command) { yield* respond(command.error); return }
        if (command.type === "help") { yield* respond(memberDataHelp); return }
        if (command.type === "list") {
            const list = yield* store.list({ userId })
            if (!list.servers.length) { yield* respond(`NeonFlux stores nothing about you\n${SECURITY_NOTE}`); return }
            yield* respond(lines([...list.servers.flatMap(server => [`Server ${server.serverId}`, ...server.features.map(item => feature(item, list.complete))]),
                SECURITY_NOTE, "Use !mydata export for a copy, or !mydata delete <server ID> to delete what may be deleted"]))
            return
        }
        if (command.type === "export") {
            // The servers come from a search through every table in bounded calls, since the listing reads only a few rows per table
            const found = new Set(command.serverId ? [command.serverId] : [])
            let searched = true
            if (!command.serverId) {
                let next: C.MemberDataServerCursor | null = null, calls = 0
                do {
                    const page: C.MemberDataServerPage = yield* store.servers({ userId, cursor: next })
                    calls++
                    for (const serverId of page.serverIds) found.add(serverId)
                    next = page.cursor
                } while (next && calls < SERVER_CALLS)
                searched = !next
            }
            const servers: Array<{ serverId: string, records: C.MemberDataExportPage["records"] }> = []
            let pages = 0, stopped = false
            exporting: for (const serverId of [...found].sort((a, b) => a.localeCompare(b))) {
                const records: C.MemberDataExportPage["records"] = []
                servers.push({ serverId, records })
                let cursor: C.MemberDataCursor | null = null
                do {
                    if (pages >= EXPORT_PAGES) { stopped = true; break exporting }
                    const page: C.MemberDataExportPage = yield* store.export({ userId, serverId, cursor })
                    pages++
                    records.push(...page.records)
                    cursor = page.cursor
                } while (cursor)
            }
            const notes = [...stopped ? [`This export stopped at ${EXPORT_PAGES * 100} records. Export the rest one server at a time with !mydata export <server ID>`] : [],
                ...searched ? [] : [`The search for servers that hold your data stopped after ${SERVER_CALLS} rounds, so servers it did not reach are missing. Export such a server with !mydata export <server ID>`]]
            const file = JSON.stringify({ userId, exportedAt: new Date().toISOString(), complete: !notes.length, servers }, null, 2)
            yield* client.messages.send(message.channelId, {
                content: notes.length ? notes.join("\n") : "Your NeonFlux data. It holds what NeonFlux stores under your user ID in each server",
                allowedMentions: noMentions, attachments: [{ filename: "neonflux-my-data.json", contentType: "application/json", data: new TextEncoder().encode(file) }],
            }, { timeoutMs: 5000 })
            return
        }
        if (!command.confirm) {
            const server = (yield* store.list({ userId })).servers.find(item => item.serverId === command.serverId)
            if (!server) { yield* respond(`NeonFlux stores nothing about you in server ${command.serverId} that it can list`); return }
            const removable = server.features.filter(item => !item.kept), kept = server.features.filter(item => item.kept)
            yield* respond(lines([`Deleting your data in server ${command.serverId} removes:`, ...removable.length ? removable.map(item => `- ${item.feature}`) : ["- Nothing that may be deleted"],
                ...kept.length ? ["It keeps:", ...kept.map(item => `- ${item.feature}: ${item.kept}`)] : [],
                "Some items in use, such as a greeting being sent or an open suggestion, may also stay for now. The reply after deleting says which",
                `Send !mydata delete ${command.serverId} confirm to delete. This cannot be undone`]))
            return
        }
        const deleted = new Map<string, number>(), kept = new Map<string, { count: number, reason: string }>()
        let cursor: C.MemberDataCursor | null = null, calls = 0
        do {
            const page: C.MemberDataDeletePage = yield* store.delete({ userId, userName: message.author.username, serverId: command.serverId, cursor })
            calls++
            for (const item of page.deleted) deleted.set(item.feature, (deleted.get(item.feature) ?? 0) + item.count)
            for (const item of page.kept) kept.set(item.feature, { count: (kept.get(item.feature)?.count ?? 0) + item.count, reason: item.reason })
            cursor = page.cursor
        } while (cursor && calls < DELETE_CALLS)
        yield* respond(lines([
            deleted.size ? `Deleted in server ${command.serverId}:` : `Nothing was deleted in server ${command.serverId}`, ...[...deleted].map(([name, count]) => `- ${name}: ${count}`),
            ...kept.size ? ["Kept:", ...[...kept].map(([name, item]) => `- ${name}: ${item.count}. ${item.reason}`)] : [],
            ...cursor ? [`More remains. Send !mydata delete ${command.serverId} confirm again to continue`] : [],
            ...deleted.size ? ["The server's managers see in their audit log that you deleted data and from which features, never the data itself"] : [],
        ]))
    }).pipe(Effect.catchTag("MemberDataStoreError", () => respond("Your data could not be read or deleted right now. Try again shortly")), Effect.asVoid)
}
