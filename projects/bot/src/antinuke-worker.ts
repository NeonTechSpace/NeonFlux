import {
    defaultAntiNukeSettings,
    type AntiNukeAction,
    type AntiNukeActorKind,
    type AntiNukeIncident,
    type AntiNukeLockdownResult,
    type AntiNukeSettings,
} from "@neonflux/contracts/anti-nuke"
import {
    format,
    hierarchy,
    Permissions,
    snowflakes,
    type Client,
    type GuildAuditLogEntryCreate,
    type GuildMember,
    type GuildRole,
} from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import { dangerousPermissions, gainedPermissions, nativeOutcome } from "./alerts-worker.ts"
import { createAntiNukeState, type AntiNukeFired } from "./antinuke-detector.ts"
import type { AntiNukeStore } from "./antinuke-store.ts"
import { auditRoleChange } from "./audit-changes.ts"
import { contained, warnFailure } from "./contained.ts"
import { lockdownRuntimes } from "./lockdown-worker.ts"
import { readNativeMember } from "./member-evidence.ts"
import { rightRoleIds, rightsRuntimes } from "./rights-memory.ts"
import { readAuthenticatedBotId, readNativeAccount, readSafetyAuthority } from "./safety-permissions.ts"
import { replyPrefix, serverReplyStyle } from "./general-settings.ts"
import { code, renderCard } from "./reply-style.ts"

const loadRetryMs = 60000
// Fluxer's edge answers a plain 429 with a five second wait when busy, and a wait as long as the timeout fails the call unsent, which the
// incident would then lose for its whole window
const options = { timeoutMs: 15000, auditReason: "NeonFlux anti-nuke" }
// Whether an account is a bot is read once per account, which only happens on a server with the module on
const KNOWN_ACCOUNTS = 200
const dangerousMask = dangerousPermissions.reduce((mask, name) => mask | Permissions[name], 0n)

/** Rank checks whose snapshots the SDK cannot use count as not allowed */
const allowed = (check: () => boolean) => {
    try {
        return check()
    } catch {
        return false
    }
}
/** The roles of a member that carry a dangerous permission and that NeonFlux outranks */
const strippableRoles = (
    member: GuildMember,
    roles: readonly GuildRole[],
    guild: Parameters<typeof hierarchy.canManageRole>[0]["guild"],
    bot: GuildMember,
    rightRoles: readonly string[],
) =>
    roles.filter(
        (role) =>
            member.roleIds.includes(role.id) &&
            // A role that holds a bot-only right is as dangerous as one with the real permission, since that is how the member acted
            ((role.permissions & dangerousMask) !== 0n || rightRoles.includes(role.id)) &&
            allowed(() => hierarchy.canManageRole({ guild, actor: bot, role, roles })),
    )

/** The action an audit entry counts as, if any. Fluxer's audit numbers are listed in its SDK as AuditLogActionType */
function auditAction(entry: GuildAuditLogEntryCreate, dangerous: (ids: readonly string[]) => boolean | undefined) {
    switch (entry.actionType) {
        case 22:
            return "ban" as const
        case 20:
            return "kick" as const
        case 23:
            return "unban" as const
        case 21:
            return "prune" as const
        case 12:
            return "channel-delete" as const
        case 10:
            return "channel-create" as const
        case 32:
            return "role-delete" as const
        // A new role given dangerous permissions counts like an old role that gained them
        case 30:
            return gainedPermissions(entry.changes).length ? ("role-perms" as const) : ("role-create" as const)
        case 31:
            return gainedPermissions(entry.changes).length ? ("role-perms" as const) : undefined
        case 50:
            return "webhook-create" as const
        // A role bot changes member roles all day, so only a dangerous role given or taken counts. Fluxer records a change of the whole
        // list as a member update, with the roles among its changes, and adding or removing one role as a role update
        case 24:
        case 25: {
            const change = auditRoleChange(entry.changes)
            return dangerous([...change.added, ...change.removed]) ? ("member-roles" as const) : undefined
        }
        default:
            return undefined
    }
}

const ruleTexts: Record<AntiNukeIncident["rule"], string> = {
    bans: "Bans at machine speed",
    kicks: "Kicks at machine speed",
    channels: "Channels deleted at machine speed",
    roles: "Roles deleted at machine speed",
    unbans: "Unbans at machine speed",
    prunes: "Repeated prunes",
    webhooks: "A flood of webhooks",
    creates: "A flood of new channels or roles",
    grants: "Dangerous permissions handed out at machine speed",
    mixed: "Destruction across several kinds",
    slow: "A long run of destruction",
    colluding: "Several accounts destroying together",
}
/** What a rule means for staff. A slow burn usually only alerts, and a bot working too fast for its kind is stopped */
export const antiNukeRuleText = (rule: AntiNukeIncident["rule"], alertOnly: boolean) =>
    rule === "slow" && alertOnly
        ? `${ruleTexts.slow}, at a pace ordinary work can reach, so NeonFlux touched nothing`
        : ruleTexts[rule]
const noteResult = {
    alert: "Alert only",
    none: "Nothing to remove",
    succeeded: "Done",
    failed: "Failed",
    uncertain: "Not confirmed",
}

/**
 * When an audit entry happened, from its own ID, since entries held back by a lost connection all arrive at once. An ID the SDK cannot read, or
 * one from a clock ahead of this one, counts as now
 */
const entryTime = (id: string, now: number) => {
    try {
        return Math.min(snowflakes.createdAt(id).getTime(), now)
    } catch {
        return now
    }
}

export type AntiNukeRuntime = ReturnType<typeof createAntiNuke>
/** Each running server's anti-nuke, so dashboard changes reach it and other features can report what they do through NeonFlux */
export const antiNukeRuntimes = new Map<string, AntiNukeRuntime>()

/**
 * Anti-nuke for one server. Settings load once when the server starts and stay in memory, and the counts stay in memory only, so audit
 * entries cost no backend call while the module is off and while nothing fires. A restart forgets the counts. An incident is claimed
 * before any native call, and its one native call is never repeated: An unknown outcome stays uncertain until staff read it
 */
export function createAntiNuke(store: AntiNukeStore, serverId: string, notify: () => Effect.Effect<void>) {
    let settings: AntiNukeSettings = defaultAntiNukeSettings()
    let loaded = false,
        lastLoadAt = Number.NEGATIVE_INFINITY
    const state = createAntiNukeState(settings.limits)
    const accounts = new Map<string, boolean>()
    // Who owns the server is read once for counting. A response reads it fresh, so a transfer never lets NeonFlux act on the owner
    let ownerId: string | undefined
    const apply = (next: AntiNukeSettings) => {
        for (const id of next.trustedIds) if (!settings.trustedIds.includes(id)) state.forget(id)
        settings = next
        state.setLimits(next.limits)
        loaded = true
    }
    const load = Effect.gen(function* () {
        lastLoadAt = yield* Clock.currentTimeMillis
        apply((yield* store.get({ serverId })).settings)
    })
    const ensureLoaded = Effect.gen(function* () {
        if (!loaded && (yield* Clock.currentTimeMillis) - lastLoadAt >= loadRetryMs)
            yield* contained(load, "Anti-nuke settings could not be loaded. It pauses until the backend answers")
    })
    const isBot = (client: Client, id: string) =>
        Effect.gen(function* () {
            const known = accounts.get(id)
            if (known !== undefined) return known
            const account = yield* readNativeAccount(client, id).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (!account) return false
            accounts.set(id, account.isBot)
            if (accounts.size > KNOWN_ACCOUNTS) accounts.delete(accounts.keys().next().value!)
            return account.isBot
        })

    /** What NeonFlux may do about one account, from fresh reads, and the one native call that does it */
    const plan = (fired: AntiNukeFired, client: Client) =>
        Effect.gen(function* () {
            const botId = yield* readAuthenticatedBotId(client)
            const authority = yield* readSafetyAuthority(client, serverId, botId, {
                targetId: fired.actor,
                allowAbsentTarget: true,
            })
            const { guild, bot, roles, target } = authority,
                held = authority.botServerPermissions
            const canAct = target && allowed(() => hierarchy.canManage({ guild, actor: bot, target, roles }))
            const actorKind: AntiNukeActorKind =
                guild.ownerId === fired.actor
                    ? "owner"
                    : settings.trustedIds.includes(fired.actor)
                      ? "trusted"
                      : target && !canAct
                        ? "high"
                        : (target?.isBot ?? (yield* isBot(client, fired.actor)))
                          ? "bot"
                          : "staff"
            const alert = { actorKind, response: "alert" as const, removedRoleIds: [] as string[] }
            // Owners, trusted accounts and accounts that rank at or above NeonFlux only alert, and one who left has nothing to take
            if (fired.alertOnly || !target || !canAct || actorKind === "owner" || actorKind === "trusted") return alert
            const kick = {
                actorKind,
                response: "kick" as const,
                removedRoleIds: [] as string[],
                call:
                    (held & Permissions.KickMembers) !== 0n
                        ? client.members.kick({ guildId: serverId, userId: fired.actor }, options)
                        : undefined,
            }
            if (settings.response === "kick") return kick
            if (settings.response === "ban")
                return {
                    actorKind,
                    response: "ban" as const,
                    removedRoleIds: [] as string[],
                    call:
                        (held & Permissions.BanMembers) !== 0n
                            ? client.members.ban({ guildId: serverId, userId: fired.actor }, {}, options)
                            : undefined,
                }
            const strip = strippableRoles(target, roles, guild, bot, rightRoleIds(serverId)).map((role) => role.id)
            if (!strip.length && target.isBot) return kick
            const left = target.roleIds.filter((id) => !strip.includes(id))
            return {
                actorKind,
                response: "strip" as const,
                removedRoleIds: strip,
                ...(strip.length
                    ? {
                          call:
                              (held & Permissions.ManageRoles) !== 0n
                                  ? client.members.setRoles({ guildId: serverId, userId: fired.actor }, left, options)
                                  : undefined,
                      }
                    : {}),
            }
        })

    /** Claims the incident, acts once if it may, starts the lockdown if wanted and allowed, and records the outcome once */
    const respond = (fired: AntiNukeFired, client: Client) =>
        contained(
            Effect.gen(function* () {
                // A failed read, such as a 429, must not lose the incident or silence the account. What is known becomes an alert, and the
                // account's next action can still be acted on
                const known = accounts.get(fired.actor)
                const planned = yield* plan(fired, client).pipe(
                    Effect.catchCause((cause) =>
                        Cause.hasInterrupts(cause)
                            ? Effect.failCause(cause)
                            : Effect.gen(function* () {
                                  if (!fired.alertOnly) state.release(fired.actor)
                                  yield* warnFailure(
                                      "Anti-nuke could not read an account, so it only alerts for now",
                                      cause,
                                  )
                                  return {
                                      actorKind:
                                          ownerId === fired.actor
                                              ? ("owner" as const)
                                              : settings.trustedIds.includes(fired.actor)
                                                ? ("trusted" as const)
                                                : known
                                                  ? ("bot" as const)
                                                  : ("staff" as const),
                                      response: "alert" as const,
                                      removedRoleIds: [] as string[],
                                  }
                              }),
                    ),
                )
                const claim = yield* store.open({
                    serverId,
                    actorId: fired.actor,
                    actorKind: planned.actorKind,
                    rule: fired.rule,
                    counts: fired.counts,
                    firstAt: fired.firstAt,
                    lastAt: fired.lastAt,
                    response: planned.response,
                    removedRoleIds: planned.removedRoleIds,
                })
                if (!claim.claimed) return
                const noAction = !claim.act || planned.response === "alert"
                const called = "call" in planned ? planned.call : undefined
                const outcome = noAction
                    ? ("alert" as const)
                    : "call" in planned
                      ? called
                          ? yield* nativeOutcome(called)
                          : ("failed" as const)
                      : ("none" as const)
                // One account that cannot be stopped, or two at once, needs more than a response to one account
                const wanted =
                    !fired.alertOnly &&
                    (planned.actorKind === "high" ||
                        (planned.actorKind !== "owner" &&
                            planned.actorKind !== "trusted" &&
                            state.otherFiredNear(fired.actor, fired.lastAt)))
                let lockdown: AntiNukeLockdownResult = "none"
                if (wanted) {
                    const runtime = lockdownRuntimes.get(serverId)
                    lockdown =
                        claim.lockdown && runtime ? yield* runtime.startForIncident(claim.incidentNo) : "not-allowed"
                }
                const finished = yield* store.finish({ serverId, incidentNo: claim.incidentNo, outcome, lockdown })
                if (finished.admitted) yield* notify()
                // Metadata logs start off, so the staff log hears of an incident too. A lost note is not sent again
                if (finished.logChannelId) {
                    const prefix = replyPrefix(serverId, serverId)
                    yield* contained(
                        client.messages.send(
                            finished.logChannelId,
                            {
                                ...renderCard(
                                    {
                                        title: `Anti-nuke incident ${claim.incidentNo}`,
                                        description: `${format.userMention(fired.actor)}: ${antiNukeRuleText(fired.rule, fired.alertOnly)}`,
                                        fields: [["Response", noteResult[outcome]]],
                                        note: `See it with ${code(`${prefix}antinuke incident ${claim.incidentNo}`)}`,
                                    },
                                    serverReplyStyle(serverId),
                                )[0]!,
                            },
                            { timeoutMs: 5000 },
                        ),
                        "An anti-nuke staff log note could not be sent",
                    )
                }
            }),
            "An anti-nuke incident could not be completed",
        )

    const observed = (actorId: string, action: AntiNukeAction, client: Client, at?: number) =>
        Effect.gen(function* () {
            const now = at ?? (yield* Clock.currentTimeMillis)
            // The owner and trusted accounts only alert, so they are nobody's partner and never make another account act at once
            ownerId ??= (
                (yield* client.guilds.get(serverId)) ??
                (yield* client.guilds
                    .fetch(serverId, { timeoutMs: 5000 })
                    .pipe(Effect.catch(() => Effect.succeed(undefined))))
            )?.ownerId
            const alertOnly = ownerId === actorId || settings.trustedIds.includes(actorId)
            const fired = state.observe(actorId, action, now, { bot: yield* isBot(client, actorId), alertOnly })
            for (const each of fired) {
                // A refused bot action hurts nothing, so bot-only rights go in dry-run too, first, before the slower response. An alert
                // touches nothing, and the owner holds no right to take
                if (!each.alertOnly) yield* rightsRuntimes.get(serverId)?.antiNukeFired(each.actor) ?? Effect.void
                yield* respond(each, client)
            }
        })

    const runtime = {
        serverId,
        start: () =>
            Effect.gen(function* () {
                antiNukeRuntimes.set(serverId, runtime)
                yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                        if (antiNukeRuntimes.get(serverId) === runtime) antiNukeRuntimes.delete(serverId)
                    }),
                )
                // Incidents the previous process left without an outcome become uncertain. A server with the module off has none to check
                yield* Effect.forkIn(
                    Effect.gen(function* () {
                        yield* contained(
                            load,
                            "Anti-nuke settings could not be loaded. It pauses until the backend answers",
                        )
                        if (!settings.enabled) return
                        yield* contained(
                            store
                                .observe({ serverId })
                                .pipe(Effect.flatMap((result) => (result.admitted ? notify() : Effect.void))),
                            "Unfinished anti-nuke incidents could not be checked",
                        )
                    }),
                    yield* Effect.scope,
                )
            }),
        /** After a chat change the bot applied */
        changed: (next: AntiNukeSettings) => Effect.sync(() => apply(next)),
        reload: () => contained(load, "Anti-nuke settings could not be refreshed"),
        settings: () => settings,
        /** Forgets what an account did, after staff gave its roles back. Otherwise its old count would strip it again at its next action */
        forget: (id: string) => Effect.sync(() => void state.forget(id)),
        /** Counts one audit entry. It costs no backend call unless it fires, and nothing at all with the module off */
        audit: (entry: GuildAuditLogEntryCreate, client: Client) =>
            Effect.gen(function* () {
                yield* ensureLoaded
                if (!settings.enabled || !entry.userId) return
                const at = entryTime(entry.id, yield* Clock.currentTimeMillis)
                if (entry.userId === (yield* readAuthenticatedBotId(client))) return
                let roles: readonly GuildRole[] | undefined
                if ((entry.actionType === 24 || entry.actionType === 25) && auditRoleChange(entry.changes).found)
                    roles =
                        (yield* client.roles.getAll(serverId)) ??
                        (yield* client.roles.fetchAll(serverId, { timeoutMs: 5000 }))
                const action = auditAction(entry, (ids) =>
                    roles?.some((role) => ids.includes(role.id) && (role.permissions & dangerousMask) !== 0n),
                )
                if (action) yield* observed(entry.userId, action, client, at)
            }).pipe(
                Effect.catchCause((cause) =>
                    Cause.hasInterrupts(cause)
                        ? Effect.failCause(cause)
                        : warnFailure("An audit entry could not be checked for anti-nuke", cause),
                ),
            ),
        /**
         * Counts an action a member took through NeonFlux itself, whose audit entry names NeonFlux, not the member. For features that act
         * on a member's word with NeonFlux's rights
         */
        observeBotAction: (actorId: string, action: AntiNukeAction, client: Client) =>
            Effect.gen(function* () {
                yield* ensureLoaded
                if (settings.enabled && actorId !== (yield* readAuthenticatedBotId(client)))
                    yield* observed(actorId, action, client)
            }).pipe(
                Effect.catchCause((cause) =>
                    Cause.hasInterrupts(cause)
                        ? Effect.failCause(cause)
                        : warnFailure("An action through NeonFlux could not be checked for anti-nuke", cause),
                ),
            ),
    }
    return runtime
}

/** Reads the exact member an uncertain incident acted on and says what happened, without writing anything. undefined when it cannot tell */
export function readIncidentOutcome(client: Client, serverId: string, incident: AntiNukeIncident) {
    return Effect.gen(function* () {
        const { member } = yield* readNativeMember(client, serverId, incident.actorId, { allowAbsent: true })
        if (incident.response === "strip") {
            if (!member) return undefined
            return incident.removedRoleIds.some((id) => member.roleIds.includes(id)) ? "failed" : "succeeded"
        }
        if (incident.response === "ban") {
            const bans = yield* client.members.fetchBans(serverId, { timeoutMs: 5000 })
            return bans.some((ban) => ban.userId === incident.actorId) ? "succeeded" : "failed"
        }
        return member ? "failed" : "succeeded"
    }).pipe(Effect.catch(() => Effect.succeed(undefined)))
}

/**
 * Gives back the roles an incident removed and the member lacks now, from fresh reads. It writes only what the read shows is missing. A role
 * that now ranks at or above NeonFlux stays out and keeps the incident restorable, and a deleted role is named, since nothing can bring it back
 */
export function restoreIncidentRoles(client: Client, serverId: string, incident: AntiNukeIncident) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const { guild, bot, roles, target } = yield* readSafetyAuthority(client, serverId, botId, {
            targetId: incident.actorId,
            allowAbsentTarget: true,
        })
        if (!target) return { kind: "absent" as const }
        const lacking = incident.removedRoleIds.filter((id) => !target.roleIds.includes(id)),
            deleted = lacking.filter((id) => !roles.some((role) => role.id === id))
        const missing = lacking.filter((id) =>
                roles.some(
                    (role) =>
                        role.id === id && allowed(() => hierarchy.canManageRole({ guild, actor: bot, role, roles })),
                ),
            ),
            above = lacking.filter((id) => !deleted.includes(id) && !missing.includes(id))
        const written = missing.length
            ? yield* nativeOutcome(
                  client.members.setRoles(
                      { guildId: serverId, userId: incident.actorId },
                      [...target.roleIds, ...missing],
                      options,
                  ),
              )
            : ("succeeded" as const)
        return {
            kind: "done" as const,
            written,
            outcome: written === "succeeded" && above.length ? ("failed" as const) : written,
            restored: written === "succeeded" ? missing.length : 0,
            above,
            deleted,
        }
    })
}
