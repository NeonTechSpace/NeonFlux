import type { MemberDataCursor, MemberDataDeletePage, MemberDataExportPage, MemberDataFeatureCount, MemberDataServerCursor, MemberDataServerPage } from "@neonflux/contracts/member-data"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { memberDataHelp, parseMemberDataCommand } from "./member-data-command.ts"
import type { MemberDataStore } from "./member-data-store.ts"
import { noMentions } from "./responses.ts"
import { verifyPrivateAuthor } from "./safety-permissions.ts"
import { code, notSetUp, renderEmbeds, type Card } from "./reply-style.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"

// One request reads or deletes at most this many pages, so a member with a lot of data continues with another request.
// An export searches for servers in at most SERVER_CALLS calls of up to 200 index reads each
const EXPORT_PAGES = 50, SERVER_CALLS = 20, DELETE_CALLS = 20, REPLY_LIMIT = 1900
const SECURITY_NOTE = "Security records, such as spam detection counts, watchlist entries and verification links, are kept under their own expiry and are not listed"

const lines = (items: string[]) => {
    const kept: string[] = []
    for (const item of items) { if ([...kept, item].join("\n").length > REPLY_LIMIT) { kept.push(`…and more. Use ${code("!mydata export")} for everything`); break } kept.push(item) }
    return kept.join("\n")
}
// The listing counts at most 50 rows of a kind, so an incomplete listing says "or more" where a count reached that
const capped = (count: number, complete: boolean) => !complete && count >= 50
const records = (features: readonly MemberDataFeatureCount[], complete: boolean) => {
    const total = features.reduce((sum, item) => sum + item.count, 0), more = features.some(item => capped(item.count, complete))
    return `${total}${more ? " or more" : ""} record${total === 1 && !more ? "" : "s"}`
}
const MYDATA_PAGE = 10
/** The servers of the member's last list, in its numbering, and the server whose deletion they previewed last */
type Numbering = { readonly serverIds: readonly string[], readonly previewed?: string }
// This conversation covers every server, so no one server's reply style applies and the list uses the default embed

/** !mydata in a verified one-to-one conversation with the bot. Lists, exports or deletes what NeonFlux stores about the author */
export function handleMemberDataCommand(store: MemberDataStore | undefined, context: BotEventContext<"messageCreate">) {
    const { message, client } = context, userId = message.author.id
    const respond = (content: string) => context.reply({ content, allowedMentions: noMentions })
    const card = (value: Card) => Effect.forEach(renderEmbeds(value), body => context.reply({ ...body, allowedMentions: noMentions }), { discard: true })
    return Effect.gen(function* () {
        // Only the author's own private conversation may read or delete their data
        if (!(yield* verifyPrivateAuthor(client, message.channelId, userId).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false))))) return
        if (!store) { yield* respond(notSetUp("Member data requests")); return }
        const command = parseMemberDataCommand(message.content)
        if ("error" in command) { yield* respond(command.error); return }
        if (command.type === "help") { yield* respond(memberDataHelp); return }
        // A list numbers the servers it shows. !mydata <number> and !mydata delete <number> use the numbering of the last list shown here
        const numbersKey = pageKey("", message, "mydata", "numbers"), nextKey = pageKey("", message, "mydata", "list")
        const serverName = (serverId: string) => client.guilds.get(serverId).pipe(Effect.map(guild => guild?.name || "Unknown server"))
        if (command.type === "list") {
            const start = command.next ? nextPosition<number>(nextKey) : 0
            if (start === undefined) { yield* respond(noNextPage("!mydata")); return }
            const list = yield* store.list({ userId }), shown = list.servers.slice(start, start + MYDATA_PAGE)
            const next = start + MYDATA_PAGE < list.servers.length ? start + MYDATA_PAGE : undefined
            if (!shown.length) {
                rememberPosition(nextKey, undefined)
                yield* list.servers.length ? respond(noNextPage("!mydata")) : card({ title: "Your NeonFlux data", description: "NeonFlux stores nothing about you", footer: SECURITY_NOTE }); return
            }
            const names = yield* Effect.forEach(shown, server => serverName(server.serverId))
            yield* card({ title: "Your NeonFlux data", description: shown.map((server, index) => `${start + index + 1}. **${names[index]}**: ${records(server.features, list.complete)}`).join("\n"),
                fields: next === undefined ? [] : [["Next", code("!mydata next")]], note: `${code("!mydata <number>")} shows one server and how to delete there. ${code("!mydata export")} sends a copy`, footer: SECURITY_NOTE })
            rememberPosition(numbersKey, { serverIds: list.servers.map(server => server.serverId) } satisfies Numbering)
            rememberPosition(nextKey, next)
            return
        }
        if (command.type === "export") {
            // The servers come from a search through every table in bounded calls, since the listing reads only a few rows per table
            const found = new Set(command.serverId ? [command.serverId] : [])
            let searched = true
            if (!command.serverId) {
                let next: MemberDataServerCursor | null = null, calls = 0
                do {
                    const page: MemberDataServerPage = yield* store.servers({ userId, cursor: next })
                    calls++
                    for (const serverId of page.serverIds) found.add(serverId)
                    next = page.cursor
                } while (next && calls < SERVER_CALLS)
                searched = !next
            }
            const servers: Array<{ serverId: string, records: MemberDataExportPage["records"] }> = []
            let pages = 0, stopped = false
            exporting: for (const serverId of [...found].sort((a, b) => a.localeCompare(b))) {
                const records: MemberDataExportPage["records"] = []
                servers.push({ serverId, records })
                let cursor: MemberDataCursor | null = null
                do {
                    if (pages >= EXPORT_PAGES) { stopped = true; break exporting }
                    const page: MemberDataExportPage = yield* store.export({ userId, serverId, cursor })
                    pages++
                    records.push(...page.records)
                    cursor = page.cursor
                } while (cursor)
            }
            const notes = [...stopped ? [`This export stopped at ${EXPORT_PAGES * 100} records. Export the rest one server at a time with ${code("!mydata export <server ID>")}`] : [],
                ...searched ? [] : [`The search for servers that hold your data stopped after ${SERVER_CALLS} rounds, so servers it did not reach are missing. Export such a server with ${code("!mydata export <server ID>")}`]]
            const file = JSON.stringify({ userId, exportedAt: new Date().toISOString(), complete: !notes.length, servers }, null, 2)
            yield* client.messages.send(message.channelId, {
                content: notes.length ? notes.join("\n") : "Your NeonFlux data. It holds what NeonFlux stores under your user ID in each server",
                allowedMentions: noMentions, attachments: [{ filename: "neonflux-my-data.json", contentType: "application/json", data: new TextEncoder().encode(file) }],
            }, { timeoutMs: 5000 })
            return
        }
        const numbering = nextPosition<Numbering>(numbersKey), serverId = numbering?.serverIds[command.number - 1]
        if (!numbering || !serverId) { yield* respond(numbering ?`Your last list has no server ${command.number}. Send !mydata to see it again` : "Send !mydata first, then pick a server by its number"); return }
        const where = `**${yield* serverName(serverId)}**`
        if (command.type === "show" || !command.confirm) {
            const list = yield* store.list({ userId }), server = list.servers.find(item => item.serverId === serverId)
            if (!server) { yield* respond(`NeonFlux stores nothing about you in ${where} that it can list`); return }
            const removable = server.features.filter(item => !item.kept), kept = server.features.filter(item => item.kept)
            const count = (item: MemberDataFeatureCount) => `${item.count}${capped(item.count, list.complete) ? " or more" : ""}`
            if (command.type === "show") {
                yield* card({ title: "Your NeonFlux data", description: `${where}: ${records(server.features, list.complete)}`, fields: [
                    ...removable.length ? [["Deleting removes", removable.map(item => `${item.feature} (${count(item)})`).join(", ")] as const] : [],
                    ...kept.length ? [["Kept", kept.map(item => `${item.feature} (${count(item)}): ${item.kept}`).join("\n")] as const] : []],
                    ...(removable.length ? { note: `${code(`!mydata delete ${command.number}`)} shows what deleting removes, then asks you to confirm` } : {}), footer: SECURITY_NOTE })
                return
            }
            // A confirmation deletes only the server whose deletion was previewed last, and only while no newer list renumbered the servers
            rememberPosition(numbersKey, { ...numbering, previewed: serverId } satisfies Numbering)
            yield* respond(lines([`Deleting your data in ${where} removes:`, ...removable.length ? removable.map(item => `- ${item.feature}`) : ["- Nothing that may be deleted"],
                ...kept.length ? ["It keeps:", ...kept.map(item => `- ${item.feature}: ${item.kept}`)] : [],
                "Some items in use, such as a greeting being sent or an open suggestion, may also stay for now. The reply after deleting says which. This cannot be undone",
                `Confirm: ${code(`!mydata delete ${command.number} confirm`)}`]))
            return
        }
        if (numbering.previewed !== serverId) { yield* respond(`Send ${code(`!mydata delete ${command.number}`)} first to see what it deletes`); return }
        const deleted = new Map<string, number>(), kept = new Map<string, { count: number, reason: string }>()
        let cursor: MemberDataCursor | null = null, calls = 0
        do {
            const page: MemberDataDeletePage = yield* store.delete({ userId, userName: message.author.username, serverId, cursor })
            calls++
            for (const item of page.deleted) deleted.set(item.feature, (deleted.get(item.feature) ?? 0) + item.count)
            for (const item of page.kept) kept.set(item.feature, { count: (kept.get(item.feature)?.count ?? 0) + item.count, reason: item.reason })
            cursor = page.cursor
        } while (cursor && calls < DELETE_CALLS)
        yield* respond(lines([
            deleted.size ? `Deleted in ${where}:` : `Nothing was deleted in ${where}`, ...[...deleted].map(([name, count]) => `- ${name}: ${count}`),
            ...kept.size ? ["Kept:", ...[...kept].map(([name, item]) => `- ${name}: ${item.count}. ${item.reason}`)] : [],
            ...deleted.size ? ["The server's managers see in their audit log that you deleted data and from which features, never the data itself"] : [],
            ...cursor ? ["More remains", `Continue: ${code(`!mydata delete ${command.number} confirm`)}`] : [],
        ]))
    }).pipe(Effect.catchTag("MemberDataStoreError", () => respond("Your data could not be read or deleted right now. Try again shortly")), Effect.asVoid)
}
