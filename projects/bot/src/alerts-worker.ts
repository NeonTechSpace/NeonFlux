import {
    ALERT_PERMISSIONS,
    type AlertSettings,
    type AlertsActionClaimRequest,
    type AlertAction,
    type AlertActionOutcome,
} from "@neonflux/contracts/alerts"
import { InviteCode } from "@neonflux/contracts/common"
import type { MetadataLogsEvent, MetadataLogsEventType } from "@neonflux/contracts/metadata-logs"
import {
    errors,
    hierarchy,
    Permissions,
    snowflakes,
    type Client,
    type GuildAuditLogEntryCreate,
    type GuildMember,
    type GuildRole,
    type InviteDeleteEvent,
    type InviteMetadata,
} from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Exit, Schema } from "effect"
import type { AlertsStore } from "./alerts-store.ts"
import { contained } from "./contained.ts"
import { namesLookAlike } from "./alerts-names.ts"
import type { MetadataLogsStore } from "./metadata-log-store.ts"
import { createMetadataObservationSession } from "./metadata-log-projector.ts"
import { auditBits, auditNames, auditRoleChange, sameAuditName } from "./audit-changes.ts"
import {
    nativeBotAccount,
    readAuthenticatedBotId,
    readNativeAccount,
    readSafetyAuthority,
} from "./safety-permissions.ts"

// The staff names impersonation compares against are read at most every ten minutes, from the owner and every member of each
// staff role. One refresh reads at most STAFF_PAGES search pages of STAFF_PAGE members, the most Fluxer returns at once, and
// the next refresh goes on where it stopped, so a very large staff is covered over several refreshes
const STAFF_TTL_MS = 600000,
    STAFF_PAGE = 100,
    STAFF_PAGES = 20,
    NOTICED_LIMIT = 1000
const loadRetryMs = 60000

/** Permissions whose gain is reported, by their Permissions names */
export const dangerousPermissions = ALERT_PERMISSIONS
const dangerousMask = dangerousPermissions.reduce((mask, name) => mask | Permissions[name], 0n)
const staffMask =
    Permissions.Administrator |
    Permissions.ManageGuild |
    Permissions.BanMembers |
    Permissions.KickMembers |
    Permissions.ModerateMembers
const permissionNamesOf = (mask: bigint) => dangerousPermissions.filter((name) => (mask & Permissions[name]) !== 0n)

/** The dangerous permissions a recorded permissions change added, from a before and after bitfield or a list of added names */
export function gainedPermissions(changes: GuildAuditLogEntryCreate["changes"]) {
    const change = changes?.find((item) => item.key === "permissions")
    if (!change) return []
    const added = auditNames(change.newValue, "added") ?? auditNames(change.oldValue, "added")
    if (added) return dangerousPermissions.filter((name) => added.some((item) => sameAuditName(item, name)))
    const after = auditBits(change.newValue),
        before = change.oldValue === undefined ? 0n : auditBits(change.oldValue)
    return after === undefined || before === undefined ? [] : permissionNamesOf(after & ~before & dangerousMask)
}

/** An invite code as staff may see it. A code outside Fluxer's usual form is left out */
export const shownInviteCode = (code: string) => (Schema.is(InviteCode)(code) ? code : undefined)
const auditReason = "NeonFlux security alert action"
/** The permission of its own that NeonFlux spends on each action */
export const alertActionPermissions = {
    kickBots: Permissions.KickMembers,
    deleteWebhooks: Permissions.ManageWebhooks,
    removePermissions: Permissions.ManageRoles,
} as const satisfies Record<AlertAction, bigint>
/** A native action's result, classified like moderation actions: a call proven unsent or refused by Fluxer failed */
const nativeOutcome = (operation: Effect.Effect<unknown, unknown>) =>
    Effect.gen(function* () {
        const result = yield* Effect.exit(operation)
        if (Exit.isFailure(result) && Cause.hasInterrupts(result.cause)) return yield* Effect.failCause(result.cause)
        if (Exit.isSuccess(result)) return "succeeded" as const
        const outcome = errors.outcome(result.cause)
        return outcome === "notDispatched" || outcome === "rejected" ? ("failed" as const) : ("uncertain" as const)
    })
/** A rank check whose snapshots the SDK cannot use counts as not allowed */
const allowed = (check: () => boolean) => {
    try {
        return check()
    } catch {
        return false
    }
}
/** What an action would do after its fresh reads. call is absent when NeonFlux lacks the permission or the rank */
type ActionPlan = { claim: Omit<AlertsActionClaimRequest, "serverId">; call?: Effect.Effect<unknown, unknown> }

type Staff = { userId: string; names: string[] }
export type SecurityAlerts = ReturnType<typeof createSecurityAlerts>
/** Each running server's alerts, so dashboard changes applied by the bot reach them */
export const alertRuntimes = new Map<string, SecurityAlerts>()

/**
 * Security alerts for one server. The settings are read once when the server starts and kept in memory, and the bot's own
 * chat and dashboard changes update them, so the events of a server with every alert off cost no backend call. Alerts go to
 * the metadata log's security category. An alert acts on the server only when staff turned its action on
 */
export function createSecurityAlerts(
    store: AlertsStore,
    metadata: MetadataLogsStore,
    serverId: string,
    notify: () => Effect.Effect<void>,
) {
    let settings: AlertSettings = {
        invites: false,
        bots: false,
        webhooks: false,
        privileges: false,
        impersonation: false,
        kickBots: false,
        deleteWebhooks: false,
        removePermissions: false,
        expectedBotIds: [],
        expectedWebhookIds: [],
    }
    let loaded = false,
        lastLoadAt = Number.NEGATIVE_INFINITY
    let staff: { at: number; list: Staff[] } | undefined
    // A staff read in progress: the staff roles, highest first, the role and search offset it reached, and the staff found so far
    let scan: { roleIds: string[]; role: number; offset: number; found: Map<string, Staff> } | undefined
    // The name each member was last reported for, so later updates of an unchanged name stay quiet
    const noticed = new Map<string, string>()
    const observation = createMetadataObservationSession()

    const load = Effect.gen(function* () {
        lastLoadAt = yield* Clock.currentTimeMillis
        settings = (yield* store.get({ serverId })).settings
        loaded = true
    })
    const ensureLoaded = Effect.gen(function* () {
        if (!loaded && (yield* Clock.currentTimeMillis) - lastLoadAt >= loadRetryMs)
            yield* contained(
                load,
                "Security alert settings could not be loaded. Alerts pause until the backend answers",
            )
    })
    // Every alert is its own record. The backend queues records durably, so Fluxer's rate limits only pace delivery. The answer
    // says whether the alert is on record, since an action runs only for an alert staff can read about
    const send = (
        type: MetadataLogsEventType,
        fields: Pick<MetadataLogsEvent, "resourceIds" | "changedFields"> &
            Partial<Pick<MetadataLogsEvent, "actor" | "source" | "details">>,
    ) =>
        Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis,
                scope = observation(serverId, now)
            const event: MetadataLogsEvent = {
                originServerId: serverId,
                category: "security",
                type,
                source: { kind: "observation", sessionId: scope.sessionId, sequence: scope.sequence },
                observedAt: now,
                actor: { kind: "unknown" },
                count: 1,
                outcome: "observed",
                ...fields,
            }
            const result = yield* metadata.admit({ serverId, event })
            if (result.admitted) yield* notify()
            return result.admitted || result.duplicate
        }).pipe(
            Effect.catchCause((cause) =>
                Cause.hasInterrupts(cause)
                    ? Effect.failCause(cause)
                    : Effect.logWarning("A security alert could not be recorded").pipe(Effect.as(false)),
            ),
        )
    /**
     * Claims an action, then makes its one native call and records the outcome once. A plan without a call records failed.
     * Nothing retries: a claim or outcome the backend did not answer leaves the action to the next startup, which records
     * it as uncertain
     */
    const act = (prepare: Effect.Effect<ActionPlan | undefined, unknown>) =>
        contained(
            Effect.gen(function* () {
                const plan = yield* prepare
                if (!plan || !(yield* store.claimAction({ serverId, ...plan.claim })).claimed) return
                const outcome: AlertActionOutcome = plan.call ? yield* nativeOutcome(plan.call) : "failed"
                if ((yield* store.actionOutcome({ serverId, key: plan.claim.key, outcome })).admitted) yield* notify()
            }),
            "A security alert action could not be completed",
        )
    // A bot that is not NeonFlux or the owner, read fresh, is kicked when NeonFlux holds Kick members and outranks it,
    // even when it holds Administrator
    const kickBot = (member: GuildMember, client: Client) =>
        act(
            Effect.gen(function* () {
                const botId = yield* readAuthenticatedBotId(client)
                if (member.userId === botId || !nativeBotAccount(yield* readNativeAccount(client, member.userId)))
                    return undefined
                const authority = yield* readSafetyAuthority(client, serverId, botId, {
                    permission: Permissions.KickMembers,
                    targetId: member.userId,
                })
                const { guild, bot, target, roles } = authority
                if (guild.ownerId === member.userId || !target) return undefined
                const plan: ActionPlan = {
                    claim: {
                        key: `join:${member.userId}:${member.joinedAt}`,
                        action: "kickBots",
                        targetId: member.userId,
                    },
                }
                if (
                    authority.botPermissionAuthorized &&
                    allowed(() => hierarchy.canManage({ guild, actor: bot, target, roles }))
                )
                    plan.call = client.members.kick(
                        { guildId: serverId, userId: member.userId },
                        { timeoutMs: 5000, auditReason },
                    )
                return plan
            }),
        )
    // A new webhook is deleted unless the owner, NeonFlux or an expected bot created it. Changed webhooks are only reported
    const deleteWebhook = (entryId: string, webhookId: string, creatorId: string, client: Client) =>
        act(
            Effect.gen(function* () {
                const botId = yield* readAuthenticatedBotId(client)
                if (creatorId === botId) return undefined
                const authority = yield* readSafetyAuthority(client, serverId, botId, {
                    permission: Permissions.ManageWebhooks,
                })
                if (authority.guild.ownerId === creatorId) return undefined
                const plan: ActionPlan = {
                    claim: {
                        key: `audit:${entryId}`,
                        action: "deleteWebhooks",
                        targetId: webhookId,
                        actorId: creatorId,
                    },
                }
                if (authority.botPermissionAuthorized)
                    plan.call = client.webhooks.delete(webhookId, { timeoutMs: 5000, auditReason })
                return plan
            }),
        )
    // A role keeps every permission except the dangerous ones the entry added and it still holds, unless the owner, NeonFlux
    // or an expected bot made the change. NeonFlux needs Manage roles and must outrank the role
    const removePermissions = (
        entryId: string,
        roleId: string,
        actorId: string,
        gained: readonly (typeof dangerousPermissions)[number][],
        client: Client,
    ) =>
        act(
            Effect.gen(function* () {
                const botId = yield* readAuthenticatedBotId(client)
                if (actorId === botId) return undefined
                const authority = yield* readSafetyAuthority(client, serverId, botId, {
                    permission: Permissions.ManageRoles,
                })
                const { guild, bot, roles } = authority,
                    role = roles.find((item) => item.id === roleId)
                const removed = (role?.permissions ?? 0n) & gained.reduce((mask, name) => mask | Permissions[name], 0n)
                if (guild.ownerId === actorId || !role || !removed) return undefined
                const plan: ActionPlan = {
                    claim: {
                        key: `audit:${entryId}`,
                        action: "removePermissions",
                        targetId: roleId,
                        actorId,
                        permissions: permissionNamesOf(removed),
                    },
                }
                if (
                    authority.botPermissionAuthorized &&
                    allowed(() => hierarchy.canManageRole({ guild, actor: bot, role, roles }))
                )
                    plan.call = client.roles.edit(
                        { guildId: serverId, id: roleId },
                        { permissions: role.permissions & ~removed },
                        { timeoutMs: 5000, auditReason },
                    )
                return plan
            }),
        )
    const observeActions = Effect.gen(function* () {
        if ((yield* store.observeActions({ serverId })).admitted) yield* notify()
    })

    // The owner and the members of every role that holds Administrator, Manage community or a member moderation permission.
    // A read that stops early keeps the staff found so far beside the last full list, and a failed one keeps what it had until
    // the next refresh, so a missing permission logs once per refresh, not per member
    const readStaff = (client: Client) =>
        Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            if (staff && now - staff.at < STAFF_TTL_MS) return staff.list
            staff = { at: now, list: staff?.list ?? [] }
            if (!scan) {
                const roles: readonly GuildRole[] =
                    (yield* client.roles.getAll(serverId)) ??
                    (yield* client.roles.fetchAll(serverId, { timeoutMs: 5000 }))
                const guild =
                    (yield* client.guilds.get(serverId)) ?? (yield* client.guilds.fetch(serverId, { timeoutMs: 5000 }))
                const owner = yield* client.members.fetch(
                    { guildId: serverId, userId: guild.ownerId },
                    { timeoutMs: 5000 },
                )
                scan = {
                    roleIds: roles
                        .filter((role) => role.id !== serverId && (role.permissions & staffMask) !== 0n)
                        .sort((a, b) => hierarchy.compare(b, a))
                        .map((role) => role.id),
                    role: 0,
                    offset: 0,
                    found: new Map([
                        [owner.userId, { userId: owner.userId, names: [owner.username, owner.nickname ?? ""] }],
                    ]),
                }
            }
            const reading = scan
            for (let pages = 0; pages < STAFF_PAGES && reading.role < reading.roleIds.length; pages++) {
                const page = yield* client.members.search(
                    serverId,
                    { roleIds: [reading.roleIds[reading.role]!], limit: STAFF_PAGE, offset: reading.offset },
                    { timeoutMs: 5000 },
                )
                // While Fluxer builds its member index the page is empty, so the next refresh asks again
                if (page.indexing) break
                for (const hit of page.members)
                    if (!hit.isBot && !reading.found.has(hit.userId))
                        reading.found.set(hit.userId, {
                            userId: hit.userId,
                            names: [hit.username, hit.displayName ?? "", hit.nickname ?? ""],
                        })
                reading.offset += page.members.length
                if (page.members.length < STAFF_PAGE || reading.offset >= page.totalResultCount) {
                    reading.role++
                    reading.offset = 0
                }
            }
            const done = reading.role >= reading.roleIds.length
            if (done) scan = undefined
            const list = done
                ? [...reading.found.values()]
                : [
                      ...new Map([
                          ...staff.list.map((entry) => [entry.userId, entry] as const),
                          ...reading.found,
                      ]).values(),
                  ]
            staff = { at: now, list }
            return list
        }).pipe(
            Effect.catchCause((cause) =>
                Cause.hasInterrupts(cause)
                    ? Effect.failCause(cause)
                    : Effect.logWarning(
                          "Staff names could not be read for the impersonation check. NeonFlux needs Manage community",
                      ).pipe(Effect.map(() => staff?.list ?? [])),
            ),
        )
    const impersonation = (member: GuildMember, client: Client) =>
        contained(
            Effect.gen(function* () {
                const candidates = [
                    ["username", member.username],
                    ["nickname", member.nickname ?? ""],
                ] as const
                const key = candidates.map(([, name]) => name).join("\n")
                if (noticed.get(member.userId) === key) return
                const list = yield* readStaff(client)
                if (list.some((entry) => entry.userId === member.userId)) return
                for (const [field, name] of candidates) {
                    const match = list.find((entry) => entry.names.some((staffName) => namesLookAlike(name, staffName)))
                    if (!match) continue
                    noticed.delete(member.userId)
                    noticed.set(member.userId, key)
                    if (noticed.size > NOTICED_LIMIT) noticed.delete(noticed.keys().next().value!)
                    yield* send("impersonation", { resourceIds: [member.userId, match.userId], changedFields: [field] })
                    return
                }
            }),
            "A member name could not be checked for impersonation",
        )

    const runtime = {
        serverId,
        start: () =>
            Effect.gen(function* () {
                alertRuntimes.set(serverId, runtime)
                yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                        if (alertRuntimes.get(serverId) === runtime) alertRuntimes.delete(serverId)
                    }),
                )
                // The reads run beside the rest of the server's startup, which never waits for them. Actions the previous process
                // left without an outcome become uncertain, and none is tried again
                yield* Effect.forkIn(
                    Effect.andThen(
                        contained(
                            load,
                            "Security alert settings could not be loaded. Alerts pause until the backend answers",
                        ),
                        contained(observeActions, "Unfinished security alert actions could not be checked"),
                    ),
                    yield* Effect.scope,
                )
            }),
        /** After a chat or dashboard change the bot applied */
        changed: (next: AlertSettings) =>
            Effect.sync(() => {
                settings = next
                loaded = true
            }),
        reload: () => contained(load, "Security alert settings could not be refreshed"),
        settings: () => settings,
        memberAdd: (member: GuildMember, client: Client) =>
            Effect.gen(function* () {
                yield* ensureLoaded
                if (member.isBot) {
                    if (settings.bots && !settings.expectedBotIds.includes(member.userId)) {
                        const recorded = yield* send("bot-join", { resourceIds: [member.userId], changedFields: [] })
                        if (recorded && settings.kickBots) yield* kickBot(member, client)
                    }
                } else if (settings.impersonation) yield* impersonation(member, client)
            }),
        memberUpdate: (member: GuildMember, client: Client) =>
            Effect.gen(function* () {
                yield* ensureLoaded
                if (!member.isBot && settings.impersonation) yield* impersonation(member, client)
            }),
        /** Webhook and privilege alerts come from audit entries, which name the change and who made it */
        audit: (entry: GuildAuditLogEntryCreate, client: Client) =>
            Effect.gen(function* () {
                yield* ensureLoaded
                const target = entry.targetId,
                    proof = {
                        source: { kind: "audit" as const, auditEntryId: entry.id },
                        actor: entry.userId
                            ? { kind: "audit" as const, userId: entry.userId }
                            : { kind: "unknown" as const },
                    }
                if (!target || !snowflakes.isValid(target)) return
                // An action needs the entry's actor, who must not be an expected bot. Without one NeonFlux only reports
                const actorId =
                    entry.userId && !settings.expectedBotIds.includes(entry.userId) ? entry.userId : undefined
                if (
                    settings.webhooks &&
                    (entry.actionType === 50 || entry.actionType === 51) &&
                    !settings.expectedWebhookIds.includes(target)
                ) {
                    const recorded = yield* send("webhook-change", {
                        ...proof,
                        resourceIds: [target],
                        changedFields: [entry.actionType === 50 ? "created" : "updated"],
                    })
                    if (recorded && entry.actionType === 50 && settings.deleteWebhooks && actorId)
                        yield* deleteWebhook(entry.id, target, actorId, client)
                }
                if (!settings.privileges) return
                if (entry.actionType === 30 || entry.actionType === 31) {
                    const gained = gainedPermissions(entry.changes)
                    if (gained.length) {
                        const recorded = yield* send("privilege-change", {
                            ...proof,
                            resourceIds: [target],
                            changedFields: ["role-permissions", ...gained],
                        })
                        if (recorded && settings.removePermissions && actorId)
                            yield* removePermissions(entry.id, target, actorId, gained, client)
                    }
                    // A member given a role is only reported, since NeonFlux removes only roles it granted
                } else if (entry.actionType === 25) {
                    const added = auditRoleChange(entry.changes).added
                    if (!added.length) return
                    const roles =
                        (yield* client.roles.getAll(serverId)) ??
                        (yield* client.roles.fetchAll(serverId, { timeoutMs: 5000 }))
                    const granted = roles.filter(
                        (role) => added.includes(role.id) && (role.permissions & dangerousMask) !== 0n,
                    )
                    const gained = permissionNamesOf(granted.reduce((mask, role) => mask | role.permissions, 0n))
                    // A record names up to 20 resources, so it lists the member and 19 of the roles, and the gained
                    // permissions of every role
                    if (granted.length)
                        yield* send("privilege-change", {
                            ...proof,
                            resourceIds: [target, ...granted.slice(0, 19).map((role) => role.id)],
                            changedFields: ["member-roles", ...gained],
                        })
                }
            }).pipe(
                Effect.catchCause((cause) =>
                    Cause.hasInterrupts(cause)
                        ? Effect.failCause(cause)
                        : Effect.logWarning("A privilege change could not be checked"),
                ),
            ),
        /** Invite logs keep the invite's code, so the security category belongs in a staff-only channel */
        inviteCreated: (invite: InviteMetadata) =>
            Effect.gen(function* () {
                yield* ensureLoaded
                if (!settings.invites) return
                const inviteCode = shownInviteCode(invite.code)
                yield* send("invite-create", {
                    resourceIds: [invite.channel.id],
                    actor: invite.inviterId ? { kind: "event", userId: invite.inviterId } : { kind: "unknown" },
                    changedFields: [
                        ...(invite.maxAgeSeconds === 0 ? ["never-expires"] : []),
                        ...(invite.maxUses === 0 ? ["unlimited-uses"] : []),
                    ],
                    ...(inviteCode ? { details: { inviteCode } } : {}),
                })
            }),
        inviteDeleted: (event: InviteDeleteEvent) =>
            Effect.gen(function* () {
                yield* ensureLoaded
                if (!settings.invites) return
                const inviteCode = shownInviteCode(event.code)
                yield* send("invite-delete", {
                    resourceIds: event.channelId ? [event.channelId] : [],
                    changedFields: [],
                    ...(inviteCode ? { details: { inviteCode } } : {}),
                })
            }),
    }
    return runtime
}
