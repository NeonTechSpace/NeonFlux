import type { AlertSettings } from "@neonflux/contracts/alerts"
import type { MetadataLogsEvent, MetadataLogsEventType } from "@neonflux/contracts/metadata-logs"
import { Permissions, snowflakes, type Client, type GuildAuditLogEntryCreate, type GuildMember, type GuildRole, type InviteMetadata } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import type { AlertsStore } from "./alerts-store.ts"
import { namesLookAlike } from "./alerts-names.ts"
import { fluxerlyNext } from "./fluxerly-next.ts"
import type { MetadataLogsStore } from "./metadata-log-store.ts"
import { createMetadataObservationSession } from "./metadata-log-projector.ts"

// At most ten alerts at once per server, then one a minute, so a raid or a mass role change cannot flood the staff channel
// or the backend. Skipped alerts are counted for !alerts status
export const ALERT_BURST = 10, ALERT_REFILL_MS = 60000
// The staff names impersonation compares against are read at most every ten minutes, from the owner and up to five staff roles
const STAFF_TTL_MS = 600000, STAFF_ROLES = 5, STAFF_PER_ROLE = 50, NOTICED_LIMIT = 1000
const loadRetryMs = 60000

/** Permissions whose gain is reported, by their Permissions names */
export const dangerousPermissions = ["Administrator", "ManageGuild", "ManageRoles", "ManageChannels", "ManageWebhooks", "BanMembers", "KickMembers", "ModerateMembers"] as const
const dangerousMask = dangerousPermissions.reduce((mask, name) => mask | Permissions[name], 0n)
const staffMask = Permissions.Administrator | Permissions.ManageGuild | Permissions.BanMembers | Permissions.KickMembers | Permissions.ModerateMembers
const permissionNamesOf = (mask: bigint) => dangerousPermissions.filter(name => (mask & Permissions[name]) !== 0n)
// Audit entries may name permissions as API constants such as MANAGE_GUILD, or as bitfields
const squash = (name: string) => name.replace(/_/g, "").toLowerCase()
const bits = (value: unknown) => typeof value === "string" && /^\d{1,20}$/.test(value) ? BigInt(value) : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : undefined
const diff = (value: unknown) => value !== null && typeof value === "object" && Array.isArray((value as { added?: unknown }).added) ? (value as { added: readonly string[] }).added : undefined

/** The dangerous permissions a recorded permissions change added, from a before and after bitfield or a list of added names */
export function gainedPermissions(changes: GuildAuditLogEntryCreate["changes"]) {
    const change = changes?.find(item => item.key === "permissions")
    if (!change) return []
    const added = diff(change.newValue) ?? diff(change.oldValue)
    if (added) return dangerousPermissions.filter(name => added.some(item => squash(item) === squash(name)))
    const after = bits(change.newValue), before = change.oldValue === undefined ? 0n : bits(change.oldValue)
    return after === undefined || before === undefined ? [] : permissionNamesOf(after & ~before & dangerousMask)
}
/** Role IDs a member role audit entry says were added */
function addedRoleIds(changes: GuildAuditLogEntryCreate["changes"]) {
    const value = changes?.find(item => item.key === "$add")?.newValue
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

type Staff = { userId: string, names: string[] }
export type SecurityAlerts = ReturnType<typeof createSecurityAlerts>
/** Each running server's alerts, so dashboard changes applied by the bot reach them */
export const alertRuntimes = new Map<string, SecurityAlerts>()

/**
 * Security alerts for one server. The settings are read once when the server starts and kept in memory, and the bot's own
 * chat and dashboard changes update them, so the events of a server with every alert off cost no backend call. Alerts go to
 * the metadata log's security category and never act on the server
 */
export function createSecurityAlerts(store: AlertsStore, metadata: MetadataLogsStore, serverId: string, notify: () => Effect.Effect<void>) {
    let settings: AlertSettings = { invites: false, bots: false, webhooks: false, privileges: false, impersonation: false, expectedBotIds: [], expectedWebhookIds: [] }
    // The bucket holds milliseconds of refill, so whole alerts come back exactly on the minute
    let loaded = false, lastLoadAt = Number.NEGATIVE_INFINITY, credit = ALERT_BURST * ALERT_REFILL_MS, refilledAt: number | undefined, skipped = 0
    let staff: { at: number, list: Staff[] } | undefined
    // The name each member was last reported for, so later updates of an unchanged name stay quiet
    const noticed = new Map<string, string>()
    const observation = createMetadataObservationSession()

    const contained = <A, E, R>(effect: Effect.Effect<A, E, R>, warning: string) => effect.pipe(Effect.asVoid,
        Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning(warning)))
    const load = Effect.gen(function* () {
        lastLoadAt = yield* Clock.currentTimeMillis
        settings = (yield* store.get({ serverId })).settings
        loaded = true
    })
    const ensureLoaded = Effect.gen(function* () {
        if (!loaded && (yield* Clock.currentTimeMillis) - lastLoadAt >= loadRetryMs) yield* contained(load, "Security alert settings could not be loaded. Alerts pause until the backend answers")
    })
    const allowed = Effect.map(Clock.currentTimeMillis, now => {
        credit = Math.min(ALERT_BURST * ALERT_REFILL_MS, credit + now - (refilledAt ?? now))
        refilledAt = now
        if (credit < ALERT_REFILL_MS) { skipped++; return false }
        credit -= ALERT_REFILL_MS
        return true
    })
    const send = (type: MetadataLogsEventType, fields: Pick<MetadataLogsEvent, "resourceIds" | "changedFields"> & Partial<Pick<MetadataLogsEvent, "actor" | "source">>) => contained(Effect.gen(function* () {
        if (!(yield* allowed)) return
        const now = yield* Clock.currentTimeMillis, scope = observation(serverId, now)
        const event: MetadataLogsEvent = { originServerId: serverId, category: "security", type, source: { kind: "observation", sessionId: scope.sessionId, sequence: scope.sequence },
            observedAt: now, actor: { kind: "unknown" }, count: 1, outcome: "observed", ...fields }
        if ((yield* metadata.admit({ serverId, event })).admitted) yield* notify()
    }), "A security alert could not be recorded")

    // The owner and members of the highest staff roles, which hold Administrator, Manage Server or a member moderation permission
    // A failed read counts as an empty list until the next refresh, so a missing permission logs once per refresh, not per member
    const readStaff = (client: Client) => Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        if (staff && now - staff.at < STAFF_TTL_MS) return staff.list
        staff = { at: now, list: [] }
        const local = fluxerlyNext(client)
        const roles: readonly GuildRole[] = (yield* local.roles.getAll(serverId)) ?? (yield* local.roles.fetchAll(serverId, { timeoutMs: 5000 }))
        const guild = (yield* client.guilds.get(serverId)) ?? (yield* client.guilds.fetch(serverId, { timeoutMs: 5000 }))
        const list = new Map<string, Staff>()
        const owner = yield* client.members.fetch({ guildId: serverId, userId: guild.ownerId }, { timeoutMs: 5000 })
        list.set(owner.userId, { userId: owner.userId, names: [owner.username, owner.nickname ?? ""] })
        const staffRoles = roles.filter(role => role.id !== serverId && (role.permissions & staffMask) !== 0n).sort((a, b) => b.position - a.position).slice(0, STAFF_ROLES)
        for (const role of staffRoles) {
            const page = yield* client.members.search(serverId, { roleIds: [role.id], limit: STAFF_PER_ROLE }, { timeoutMs: 5000 })
            for (const hit of page.members) if (!hit.isBot && !list.has(hit.userId)) list.set(hit.userId, { userId: hit.userId, names: [hit.username, hit.displayName ?? "", hit.nickname ?? ""] })
        }
        staff = { at: now, list: [...list.values()] }
        return staff.list
    }).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
        : Effect.logWarning("Staff names could not be read for the impersonation check. NeonFlux needs Manage Server").pipe(Effect.as([] as Staff[]))))
    const impersonation = (member: GuildMember, client: Client) => contained(Effect.gen(function* () {
        const candidates = [["username", member.username], ["nickname", member.nickname ?? ""]] as const
        const key = candidates.map(([, name]) => name).join("\n")
        if (noticed.get(member.userId) === key) return
        const list = yield* readStaff(client)
        if (list.some(entry => entry.userId === member.userId)) return
        for (const [field, name] of candidates) {
            const match = list.find(entry => entry.names.some(staffName => namesLookAlike(name, staffName)))
            if (!match) continue
            noticed.delete(member.userId)
            noticed.set(member.userId, key)
            if (noticed.size > NOTICED_LIMIT) noticed.delete(noticed.keys().next().value!)
            yield* send("impersonation", { resourceIds: [member.userId, match.userId], changedFields: [field] })
            return
        }
    }), "A member name could not be checked for impersonation")

    const runtime = {
        serverId,
        start: () => Effect.gen(function* () {
            alertRuntimes.set(serverId, runtime)
            yield* Effect.addFinalizer(() => Effect.sync(() => { if (alertRuntimes.get(serverId) === runtime) alertRuntimes.delete(serverId) }))
            // The read runs beside the rest of the server's startup, which never waits for it
            yield* Effect.forkIn(contained(load, "Security alert settings could not be loaded. Alerts pause until the backend answers"), yield* Effect.scope)
        }),
        /** After a chat or dashboard change the bot applied */
        changed: (next: AlertSettings) => Effect.sync(() => { settings = next; loaded = true }),
        reload: () => contained(load, "Security alert settings could not be refreshed"),
        settings: () => settings,
        skipped: () => skipped,
        memberAdd: (member: GuildMember, client: Client) => Effect.gen(function* () {
            yield* ensureLoaded
            if (member.isBot) {
                if (settings.bots && !settings.expectedBotIds.includes(member.userId)) yield* send("bot-join", { resourceIds: [member.userId], changedFields: [] })
            } else if (settings.impersonation) yield* impersonation(member, client)
        }),
        memberUpdate: (member: GuildMember, client: Client) => Effect.gen(function* () {
            yield* ensureLoaded
            if (!member.isBot && settings.impersonation) yield* impersonation(member, client)
        }),
        /** Webhook and privilege alerts come from audit entries, which name the change and who made it */
        audit: (entry: GuildAuditLogEntryCreate, client: Client) => Effect.gen(function* () {
            yield* ensureLoaded
            const target = entry.targetId, proof = { source: { kind: "audit" as const, auditEntryId: entry.id }, actor: entry.userId ? { kind: "audit" as const, userId: entry.userId } : { kind: "unknown" as const } }
            if (!target || !snowflakes.isValid(target)) return
            if (settings.webhooks && (entry.actionType === 50 || entry.actionType === 51) && !settings.expectedWebhookIds.includes(target)) {
                yield* send("webhook-change", { ...proof, resourceIds: [target], changedFields: [entry.actionType === 50 ? "created" : "updated"] })
            }
            if (!settings.privileges) return
            if (entry.actionType === 30 || entry.actionType === 31) {
                const gained = gainedPermissions(entry.changes)
                if (gained.length) yield* send("privilege-change", { ...proof, resourceIds: [target], changedFields: ["role-permissions", ...gained] })
            } else if (entry.actionType === 25) {
                const added = addedRoleIds(entry.changes)
                if (!added.length) return
                const local = fluxerlyNext(client)
                const roles = (yield* local.roles.getAll(serverId)) ?? (yield* local.roles.fetchAll(serverId, { timeoutMs: 5000 }))
                const granted = roles.filter(role => added.includes(role.id) && (role.permissions & dangerousMask) !== 0n).slice(0, 19)
                const gained = permissionNamesOf(granted.reduce((mask, role) => mask | role.permissions, 0n))
                if (granted.length) yield* send("privilege-change", { ...proof, resourceIds: [target, ...granted.map(role => role.id)], changedFields: ["member-roles", ...gained] })
            }
        }).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning("A privilege change could not be checked"))),
        /** Invite logs never keep the code, which grants access */
        inviteCreated: (invite: InviteMetadata) => Effect.gen(function* () {
            yield* ensureLoaded
            if (!settings.invites) return
            yield* send("invite-create", { resourceIds: [invite.channel.id], actor: invite.inviterId ? { kind: "event", userId: invite.inviterId } : { kind: "unknown" },
                changedFields: [...(invite.maxAgeSeconds === 0 ? ["never-expires"] : []), ...(invite.maxUses === 0 ? ["unlimited-uses"] : [])] })
        }),
        inviteDeleted: (channelId: string | undefined) => Effect.gen(function* () {
            yield* ensureLoaded
            if (settings.invites) yield* send("invite-delete", { resourceIds: channelId ? [channelId] : [], changedFields: [] })
        }),
    }
    return runtime
}
