import type * as C from "@neonflux/backend/contracts"
import type * as D from "@neonflux/backend/dashboard-contracts"
import { createHash } from "node:crypto"
import { format, type BotEventContext, type Client, type InviteMetadata, type Webhook } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { sourceTimestamp } from "./responses.ts"
import { at, code, notSetUp, onOff, replyCard, replyText } from "./reply-style.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { nativeFix } from "./permission-fix.ts"
import { SafetyPermissionError } from "./safety-permissions.ts"
import { alertKinds, alertsHelp, invitesHelp, parseAlertsCommand, parseInvitesCommand } from "./alerts-command.ts"
import { AlertsStoreError, type AlertsStore } from "./alerts-store.ts"
import type { SecurityAlerts } from "./alerts-worker.ts"

const INVITE_PAGE = 10, INVITE_LIMIT = 100, EXPECTED_PAGE = 10
const managerOnly = "Only the server owner or members with Manage Server can manage security alerts and invites"

/** A short hash that names an invite without its code. The code grants access, so NeonFlux never shows or stores it */
export const inviteRef = (code: string) => createHash("sha256").update(code).digest("hex").slice(0, 16)
const summary = (invite: InviteMetadata): C.AlertInvite => ({ ref: inviteRef(invite.code), channelId: invite.channel.id, inviterId: invite.inviterId ?? null, uses: invite.uses,
    maxUses: invite.maxUses, expiresAt: invite.expiresAt ?? null, createdAt: invite.createdAt, temporary: invite.temporary })
/** The server's invites, newest first, read fresh from Fluxer. Listing needs Manage Server */
export const readInvites = (client: Client, serverId: string) => client.invites.fetchForGuild(serverId, { timeoutMs: 5000 }).pipe(
    Effect.map(invites => [...invites].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))))
const inviteList = (invites: readonly InviteMetadata[]) => ({ invites: invites.slice(0, INVITE_LIMIT).map(summary), more: invites.length > INVITE_LIMIT })
/** Revokes the invite ref names, from a fresh read, and returns the invites that remain */
function revokeInvite(client: Client, serverId: string, ref: string, actorId: string) {
    return Effect.gen(function* () {
        const invites = yield* readInvites(client, serverId), target = invites.find(invite => inviteRef(invite.code) === ref)
        if (!target) return undefined
        yield* client.invites.delete(target.code, { auditReason: `Revoked with NeonFlux by ${actorId}` })
        return invites.filter(invite => invite !== target)
    })
}

function describe(error: unknown) {
    if (error instanceof AlertsStoreError) {
        if (error.status === 429) return "A server can mark at most 50 expected bots and 50 expected webhooks. Remove one first"
        if (error.status === 409) return "Alert settings changed on the website while this command ran. Check `!alerts status` and try again"
        if (error.status === 403) return managerOnly
        return "Security alerts are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    const fix = nativeFix(error)
    return fix ? `Fluxer refused the invite request. ${fix}` : "The command could not be completed. NeonFlux needs Manage Server to read and revoke invites"
}
const reader = (context: BotEventContext<"messageCreate">, serverId: string) => {
    const prefix = replyPrefix(serverId, context.message.guildId)
    return (content: string) => replyText(context, withPrefix(content, prefix))
}
const capital = (text: string) => text.replace(/^./, letter => letter.toUpperCase())
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`
const fold = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim()

/** The server's webhooks by ID, read fresh, or undefined when NeonFlux cannot list them, which needs Manage Webhooks */
const readWebhooks = (client: Client, serverId: string) => client.webhooks.fetchForGuild(serverId, { timeoutMs: 5000 }).pipe(
    Effect.map(webhooks => new Map(webhooks.map(webhook => [webhook.id, webhook] as const))), Effect.catch(() => Effect.succeed(undefined)))
const webhookName = (webhook: Webhook) => `Webhook **${format.escapeMarkdown(webhook.name)}** in ${format.channelMention(webhook.channelId)}`
/** The one webhook a name picks, or the reply when it picks none or several */
const findWebhook = (client: Client, serverId: string, name: string) => readWebhooks(client, serverId).pipe(Effect.map(webhooks => {
    if (!webhooks) return "NeonFlux needs Manage Webhooks to find a webhook by name. Use the webhook's ID instead"
    const found = [...webhooks.values()].filter(webhook => fold(webhook.name) === fold(name))
    return found.length === 1 ? found[0]! : found.length ? `Several webhooks are called ${name}. Use the webhook's ID instead` : `This server has no webhook called ${name}. Check the name or use the webhook's ID`
}))

export function handleAlertsCommand(store: AlertsStore | undefined, runtime: SecurityAlerts | undefined, config: BotConfig, args: readonly string[], context: BotEventContext<"messageCreate">) {
    const reply = reader(context, config.serverId)
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store || !runtime) { yield* reply(notSetUp("Security alerts")); return }
        const command = parseAlertsCommand(args)
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(alertsHelp); return }
        const { actor, manager } = yield* readServerManager(client, serverId, message.author.id)
        if (!manager) { yield* reply(managerOnly); return }
        const s = runtime.settings(), prefix = replyPrefix(serverId, message.guildId)
        if (command.type === "status") {
            const names = (enabled: boolean) => alertKinds.filter(kind => s[kind] === enabled).map(capital).join(", "), skipped = runtime.skipped()
            const expected = [...s.expectedBotIds.length ? [plural(s.expectedBotIds.length, "bot")] : [], ...s.expectedWebhookIds.length ? [plural(s.expectedWebhookIds.length, "webhook")] : []].join(", ")
            yield* replyCard(context, serverId, { title: "Security alerts", description: `${alertKinds.filter(kind => s[kind]).length} of ${alertKinds.length} alerts are on`,
                fields: ([["On", names(true)], ["Off", names(false)], ["Expected", expected], ["Skipped by the rate limit", skipped ? `${plural(skipped, "alert")} since NeonFlux started` : ""]] as const).filter(([, value]) => value),
                note: `Alerts appear in the metadata log's security category, see ${code(`${prefix}logs metadata status`)}. `
                    + (expected ? `${code(`${prefix}alerts expected`)} lists the expected bots and webhooks` : `${code(`${prefix}alerts help`)} shows how to change them`) })
            return
        }
        if (command.type === "expected") {
            const key = pageKey(serverId, message, "alerts", "expected"), next = command.next ? nextPosition<number>(key) : 1
            if (next === undefined) { yield* reply(noNextPage("!alerts expected")); return }
            // Bots first, then webhooks. Marks removed since the last page can shorten the list, so next shows its last page at most
            const all = [...s.expectedBotIds.map(id => ["bot", id] as const), ...s.expectedWebhookIds.map(id => ["webhook", id] as const)]
            const pages = Math.max(1, Math.ceil(all.length / EXPECTED_PAGE)), page = Math.min(next, pages), shown = all.slice((page - 1) * EXPECTED_PAGE, page * EXPECTED_PAGE)
            rememberPosition(key, page < pages ? page + 1 : undefined)
            if (!all.length) { yield* replyCard(context, serverId, { title: "Expected bots and webhooks", description: "None yet", note: `Mark a bot that may join with ${code(`${prefix}alerts expect bot <ID>`)}` }); return }
            // A webhook shows by name and channel. One NeonFlux cannot read keeps its ID, which unexpect takes
            const named = shown.some(([kind]) => kind === "webhook"), webhooks = named ? yield* readWebhooks(client, serverId) : undefined
            const line = ([kind, id]: typeof all[number]) => {
                const webhook = webhooks?.get(id)
                return kind === "bot" ? `Bot ${format.userMention(id)}` : webhook ? webhookName(webhook) : `Webhook ${code(id)}${webhooks ? ", not found in this server" : ""}`
            }
            yield* replyCard(context, serverId, { title: "Expected bots and webhooks", description: shown.map(line).join("\n"), fields: page < pages ? [["Next", code(`${prefix}alerts expected next`)]] : [],
                note: `They raise no alert. Stop expecting one with ${code(`${prefix}alerts unexpect bot <ID>`)} or ${code(`${prefix}alerts unexpect webhook <name>`)}${named && !webhooks ? ". NeonFlux needs Manage Webhooks to show webhook names" : ""}` })
            return
        }
        const webhook = command.type === "expect" && "name" in command ? yield* findWebhook(client, serverId, command.name) : undefined
        if (typeof webhook === "string") { yield* reply(webhook); return }
        const id = webhook?.id ?? ("id" in command ? command.id : "")
        const createdAt = yield* sourceTimestamp(message)
        const manage = (operation: C.AlertsOperation) => store.manage({ serverId, originServerId: serverId, messageId: message.id, createdAt, actor, managerAuthorized: true, operation })
        let result: C.AlertsResult | undefined
        if (command.type === "set") for (const alert of command.alerts) result = yield* manage({ type: "set", alert, enabled: command.enabled })
        else result = yield* manage({ type: "expect", kind: command.kind, id, expected: command.expected })
        yield* runtime.changed(result!.settings)
        yield* reply(command.type === "set" ? `${command.alerts.length > 1 ? "All alerts" : `The ${command.alerts[0]} alert`} turned ${onOff(command.enabled).toLowerCase()}`
            : `${webhook ? webhookName(webhook) : command.kind === "bot" ? `Bot ${format.userMention(id)}` : `Webhook ${code(id)}`} ${command.expected ? "is marked expected. It raises no alert" : "is no longer expected"}`)
    }).pipe(Effect.catch(error => reply(describe(error))), Effect.asVoid)
}

export function handleInvitesCommand(config: BotConfig, args: readonly string[], context: BotEventContext<"messageCreate">) {
    const reply = reader(context, config.serverId)
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        const command = parseInvitesCommand(args)
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(invitesHelp); return }
        if (!(yield* readServerManager(client, serverId, message.author.id)).manager) { yield* reply(managerOnly); return }
        if (command.type === "revoke") {
            const remaining = yield* revokeInvite(client, serverId, command.ref, message.author.id)
            yield* reply(remaining ? `Invite ${code(command.ref)} revoked. Members who joined with it stay` : "No current invite has that reference. Check `!invites list`")
            return
        }
        const key = pageKey(serverId, message, "invites", "list"), next = command.next ? nextPosition<number>(key) : 1
        if (next === undefined) { yield* reply(noNextPage("!invites list")); return }
        // Invites revoked since the last page can shorten the list, so next shows its last page at most
        const invites = yield* readInvites(client, serverId), pages = Math.max(1, Math.ceil(invites.length / INVITE_PAGE)), page = Math.min(next, pages)
        rememberPosition(key, page < pages ? page + 1 : undefined)
        if (!invites.length) { yield* replyCard(context, serverId, { title: "Invites", description: "No invites yet. A vanity link is not listed" }); return }
        // The flags name a missing limit, so the line does not repeat it
        const lines = invites.slice((page - 1) * INVITE_PAGE, page * INVITE_PAGE).map(invite => {
            const flags = [...invite.expiresAt === null || invite.maxAgeSeconds === 0 ? ["never expires"] : [], ...invite.maxUses === 0 ? ["unlimited uses"] : [], ...invite.temporary ? ["temporary membership"] : []]
            return `${code(inviteRef(invite.code))}: ${format.channelMention(invite.channel.id)}, by ${invite.inviterId ? format.userMention(invite.inviterId) : "unknown"}, `
                + `${invite.maxUses ? `${invite.uses} of ${invite.maxUses} uses` : `${invite.uses} uses`}${invite.expiresAt ? `, expires ${at(Date.parse(invite.expiresAt))}` : ""}${flags.length ? `. Flagged: ${flags.join(", ")}` : ""}`
        })
        const prefix = replyPrefix(serverId, message.guildId)
        yield* replyCard(context, serverId, { title: "Invites", description: lines.join("\n"),
            note: `Each line starts with the invite's reference. Revoke one with ${code(`${prefix}invites revoke <reference>`)}`, ...page < pages ? { fields: [["Next", code(`${prefix}invites list next`)] as const] } : {} })
    }).pipe(Effect.catch(error => reply(describe(error))), Effect.asVoid)
}

/** Native work a dashboard invite request needs: revoke the named invite, then hand the backend the invites that remain, without codes */
export function prepareAlertsDashboardJob(client: Client, serverId: string, job: D.DashboardConfigurationReadyJob) {
    return Effect.gen(function* () {
        if (job.family !== "alerts" || job.operation.type !== "invites-refresh" && job.operation.type !== "invite-revoke") return undefined
        const invites = job.operation.type === "invite-revoke" ? yield* revokeInvite(client, serverId, job.operation.ref, job.actorId) : yield* readInvites(client, serverId)
        if (!invites) return yield* Effect.fail(new Error("The invite to revoke no longer exists"))
        return { context: inviteList(invites), undo: Effect.void }
    })
}
