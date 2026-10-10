import type * as C from "@neonflux/backend/contracts"
import type * as D from "@neonflux/backend/dashboard-contracts"
import { createHash } from "node:crypto"
import type { BotEventContext, Client, InviteMetadata } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { nativeFix } from "./permission-fix.ts"
import { SafetyPermissionError } from "./safety-permissions.ts"
import { alertKinds, alertsHelp, invitesHelp, parseAlertsCommand, parseInvitesCommand } from "./alerts-command.ts"
import { AlertsStoreError, type AlertsStore } from "./alerts-store.ts"
import type { SecurityAlerts } from "./alerts-worker.ts"

const INVITE_PAGE = 10, INVITE_LIMIT = 100
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
        if (error.status === 409) return "Alert settings changed on the website while this command ran. Check !alerts status and try again"
        if (error.status === 403) return managerOnly
        return "Security alerts are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    const fix = nativeFix(error)
    return fix ? `Fluxer refused the invite request. ${fix}` : "The command could not be completed. NeonFlux needs Manage Server to read and revoke invites"
}
const reader = (context: BotEventContext<"messageCreate">, serverId: string) => {
    const prefix = replyPrefix(serverId, context.message.guildId)
    return (content: string) => context.reply({ content: withPrefix(content, prefix), allowedMentions: noMentions })
}
const onOff = (value: boolean) => value ? "on" : "off"
const listed = (ids: readonly string[]) => ids.length ? ids.join(", ") : "none"

export function handleAlertsCommand(store: AlertsStore | undefined, runtime: SecurityAlerts | undefined, config: BotConfig, args: readonly string[], context: BotEventContext<"messageCreate">) {
    const reply = reader(context, config.serverId)
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store || !runtime) { yield* reply("Security alert persistence is not configured"); return }
        const command = parseAlertsCommand(args)
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(alertsHelp); return }
        const { actor, manager } = yield* readServerManager(client, serverId, message.author.id)
        if (!manager) { yield* reply(managerOnly); return }
        if (command.type === "status") {
            const s = runtime.settings()
            yield* reply([`Security alerts: ${alertKinds.map(kind => `${kind} ${onOff(s[kind])}`).join(", ")}`, `Expected bots: ${listed(s.expectedBotIds)}`, `Expected webhooks: ${listed(s.expectedWebhookIds)}`,
                `Skipped by the rate limit since NeonFlux started: ${runtime.skipped()}`, "Alerts appear once metadata logs are on and the security category is routed. See !logs metadata status"].join("\n"))
            return
        }
        const createdAt = yield* sourceTimestamp(message)
        const manage = (operation: C.AlertsOperation) => store.manage({ serverId, originServerId: serverId, messageId: message.id, createdAt, actor, managerAuthorized: true, operation })
        let result: C.AlertsResult | undefined
        if (command.type === "set") for (const alert of command.alerts) result = yield* manage({ type: "set", alert, enabled: command.enabled })
        else result = yield* manage({ type: "expect", kind: command.kind, id: command.id, expected: command.expected })
        yield* runtime.changed(result!.settings)
        yield* reply(command.type === "set" ? `${command.alerts.length > 1 ? "All alerts" : `The ${command.alerts[0]} alert`} turned ${onOff(command.enabled)}`
            : `${command.kind === "bot" ? "Bot" : "Webhook"} ${command.id} ${command.expected ? "marked expected. It raises no alert" : "is no longer expected"}`)
    }).pipe(Effect.catch(error => reply(describe(error))), Effect.asVoid)
}

const when = (iso: string | null) => iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "never"
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
            yield* reply(remaining ? `Invite ${command.ref} revoked. Members who joined with it stay` : "No current invite has that reference. Check !invites list")
            return
        }
        const invites = yield* readInvites(client, serverId), pages = Math.max(1, Math.ceil(invites.length / INVITE_PAGE))
        if (!invites.length) { yield* reply("This server has no invites NeonFlux can see, apart from a vanity link"); return }
        if (command.page > pages) { yield* reply(`There ${pages === 1 ? "is 1 page" : `are ${pages} pages`} of invites`); return }
        const lines = invites.slice((command.page - 1) * INVITE_PAGE, command.page * INVITE_PAGE).map(invite => {
            const flags = [...invite.maxAgeSeconds === 0 ? ["never expires"] : [], ...invite.maxUses === 0 ? ["unlimited uses"] : [], ...invite.temporary ? ["temporary membership"] : []]
            return `${inviteRef(invite.code)}: <#${invite.channel.id}>, by ${invite.inviterId ? `<@${invite.inviterId}>` : "unknown"}, ${invite.uses}/${invite.maxUses || "∞"} uses, expires ${when(invite.expiresAt ?? null)}${flags.length ? `. Flagged: ${flags.join(", ")}` : ""}`
        })
        yield* reply([`Invites, page ${command.page} of ${pages}, newest first`, ...lines, ...command.page < pages ? [`Next: !invites list ${command.page + 1}`] : []].join("\n"))
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
