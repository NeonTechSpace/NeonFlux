import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { ModerationStoreError, type ModerationStore } from "../src/moderation-store.ts"

export const token = Redacted.make("synthetic-moderation-test-token")
export function settings(): C.ModerationSettings {
    return { staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] }, logChannelId: null, manualModerationEnabled: true,
        automodEnabled: false, automodMode: "dry-run", automodBotMessagesEnabled: false, securityEnabled: false, securityMode: "dry-run", joinEnabled: false,
        joinThreshold: 5, joinWindowSeconds: 10, joinDefcon2: false, honeypotEnabled: false, honeypotChannelIds: [], watchlistEnabled: false, appealsEnabled: true, defcon: 3 }
}
export function boundary(overrides: Partial<ModerationStore> = {}) {
    const calls: { method: string, input: unknown }[] = []
    const current = settings()
    const reject = (method: string, input: unknown) => { calls.push({ method, input }); return Effect.fail(new ModerationStoreError({ operation: method, status: 403 })) }
    const store: ModerationStore = {
        manage: (input) => reject("manage", input),
        query: (input) => { calls.push({ method: "query", input }); return Effect.succeed({ type: "settings", settings: current }) },
        evaluate: (input) => { calls.push({ method: "evaluate", input }); return Effect.succeed({ duplicate: false, blocked: false }) },
        join: (input) => { calls.push({ method: "join", input }); return Effect.succeed({ duplicate: false, settings: current }) },
        dispatch: (input) => { calls.push({ method: "dispatch", input }); return Effect.succeed({ recorded: false }) },
        outcome: (input) => { calls.push({ method: "outcome", input }); return Effect.succeed({ recorded: true }) },
        logOutcome: (input) => { calls.push({ method: "logOutcome", input }); return Effect.succeed({ recorded: true }) },
        noticeOutcome: (input) => { calls.push({ method: "noticeOutcome", input }); return Effect.succeed({ recorded: true }) },
        reconcile: (input) => reject("reconcile", input),
        observe: (input) => { calls.push({ method: "observe", input }); return Effect.succeed({ settings: current, uncertainActions: 0, uncertainLogs: 0 }) },
        gate: (input) => { calls.push({ method: "gate", input }); return Effect.succeed({ allowed: current.defcon === 3 || (current.defcon === 2 && input.command !== "public") || (input.command === "critical" && (input.actor.isOwner || input.actor.isAdministrator)), defcon: current.defcon, messageProtectionEnabled: current.automodEnabled || current.securityEnabled, joinProtectionEnabled: current.securityEnabled && current.joinEnabled, botMessageProtectionEnabled: current.automodEnabled && current.automodBotMessagesEnabled }) },
        memberAppeal: (input) => reject("memberAppeal", input), staffAppeal: (input) => reject("staffAppeal", input), ...overrides,
    }
    return { store, calls, current }
}
export function caseGrant(request: C.ModerationManageRequest, overrides: Partial<C.ModerationActionGrant> = {}): Extract<C.ModerationManageResult, { type: "case" }> {
    if (request.operation.type !== "action") throw new Error("Synthetic action required")
    const action = request.operation.action
    const grant: C.ModerationActionGrant = { actionId: "synthetic_case_id", caseNo: 1, sourceId: request.messageId,
        action: action.type, reason: action.reason, ...(action.targetId ? { targetId: action.targetId } : {}), ...(action.channelId ? { channelId: action.channelId } : {}),
        ...(action.durationSeconds ? { durationSeconds: action.durationSeconds } : {}), ...(action.messageIds ? { messageIds: action.messageIds } : {}),
        ...(action.slowmodeSeconds !== undefined ? { slowmodeSeconds: action.slowmodeSeconds } : {}), ...overrides }
    const record: C.ModerationCase = { ...grant, origin: "manual", actorId: request.actor.userId, createdAt: request.createdAt, expiresAt: request.createdAt + 180 * 86400000,
        outcome: "pending", logOutcome: "none", notificationOutcome: "none", erased: false, voided: false, corrections: [], ...(action.linkedCaseNo ? { linkedCaseNo: action.linkedCaseNo } : {}) }
    return { duplicate: false, type: "case", case: record, grant }
}

export function platform(bot: Effect.Success<ReturnType<typeof createTestBot>>, options: { actorOwner?: boolean, actorPermissions?: bigint, botPermissions?: bigint, targetPermissions?: bigint, everyonePermissions?: bigint, channelDeny?: bigint, guild?: Record<string, unknown> } = {}) {
    const f = bot.fixtures
    const targetId = f.nextId()
    const dmId = f.nextId()
    const actorRole = f.role({ position: 10, permissions: (options.actorPermissions ?? Permissions.Administrator).toString() })
    const botRole = f.role({ position: 20, permissions: (options.botPermissions ?? Permissions.Administrator).toString() })
    const targetRole = f.role({ position: 1, permissions: (options.targetPermissions ?? 0n).toString() })
    const guild = f.guild({ owner_id: options.actorOwner === false ? f.nextId() : f.ids.user, ...options.guild })
    const self = bot.rest.respond("GET /users/@me", { body: f.botUser() })
    const guildRoute = bot.rest.respond("GET /guilds/:id", { body: guild })
    const roles = [f.role({ id: f.ids.guild, permissions: (options.everyonePermissions ?? 0n).toString() }), actorRole, botRole, targetRole]
    const rolesRoute = bot.rest.respond("GET /guilds/:id/roles", { body: roles })
    const actor = bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: f.member({ roles: [actorRole.id], communication_disabled_until: null }) })
    const ownMember = bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, { body: f.member({ user: f.botUser(), roles: [botRole.id], communication_disabled_until: null }) })
    const target = bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${targetId}`, { body: f.member({ user: f.user({ id: targetId }), roles: [targetRole.id], communication_disabled_until: null }) })
    const channel = bot.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel({ permission_overwrites: options.channelDeny ? [{ id: f.ids.bot, type: 1, allow: "0", deny: options.channelDeny.toString() }] : [] }) })
    const replies = bot.rest.respond("POST /channels/:id/messages", (request) => ({ body: f.message({ channel_id: request.path.split("/")[2], author: f.botUser() }) }))
    const dm = { id: dmId, type: 1, recipients: [f.user()], last_message_id: null }
    const open = bot.rest.respond("POST /users/@me/channels", (request) => ({ body: { ...dm, recipients: [f.user({ id: (request.body as { recipient_id: string }).recipient_id })] } }))
    const privateFetch = bot.rest.respond(`GET /channels/${dmId}`, { body: dm })
    return { targetId, dmId, actorRole, botRole, targetRole, self, guildRoute, roles, rolesRoute, actor, ownMember, target, channel, replies, open, privateFetch }
}
