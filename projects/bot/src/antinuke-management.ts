import {
    ANTI_NUKE_TRUST_LIMIT,
    antiNukeRestorable,
    type AntiNukeIncident,
    type AntiNukeLimits,
    type AntiNukeSettings,
} from "@neonflux/contracts/anti-nuke"
import type { DashboardConfigurationReadyJob } from "@neonflux/contracts/dashboard"
import { format, Permissions, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import { antinukeHelp, parseAntiNukeCommand } from "./antinuke-command.ts"
import { AntiNukeStoreError, type AntiNukeStore } from "./antinuke-store.ts"
import {
    antiNukeRuleText,
    antiNukeRuntimes,
    readIncidentOutcome,
    restoreIncidentRoles,
    type AntiNukeRuntime,
} from "./antinuke-worker.ts"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { fixSentence, permissionNames } from "./permission-fix.ts"
import { ago, code, notSetUp, onOff, replyCard, replyText, type Card } from "./reply-style.ts"
import { sourceTimestamp } from "./responses.ts"
import { readAuthenticatedBotId, readSafetyAuthority, SafetyPermissionError } from "./safety-permissions.ts"

export class AntiNukeHandlingError extends Data.TaggedError("AntiNukeHandlingError")<{
    readonly problem: string
}> {}

const ownerOnly = "Only the server owner or an Administrator can use anti-nuke"
const PAGE = 10
function describe(error: unknown) {
    if (error instanceof AntiNukeStoreError) {
        if (error.status === 403) return ownerOnly
        if (error.status === 429)
            return `Anti-nuke can trust at most ${ANTI_NUKE_TRUST_LIMIT} accounts. Remove one first`
        if (error.status === 404) return "This member has no such incident. Check !antinuke incidents"
        if (error.status === 409)
            return "Anti-nuke changed on the website while this command ran. Check !antinuke status and try again"
        return "Anti-nuke is unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    return "The command could not be completed. Check !antinuke status"
}
const limitText = (limits: AntiNukeLimits) =>
    (["bans", "kicks", "channels", "roles"] as const)
        .map((name) => `${limits[name].count} ${name} in ${limits[name].seconds}s`)
        .join(", ")
const ruleText = (incident: AntiNukeIncident) => antiNukeRuleText(incident.rule, incident.response === "alert")
const responseText = (incident: AntiNukeIncident) => {
    if (incident.mode === "dry-run") return "Dry run, recorded only"
    const what = {
        alert: "Alert only",
        strip: `Remove ${incident.removedRoleIds.length} ${incident.removedRoleIds.length === 1 ? "role" : "roles"}`,
        kick: "Kick",
        ban: "Ban",
    }[incident.response]
    const result = {
        alert: "",
        pending: ": Running",
        none: ": Nothing to remove",
        succeeded: ": Done",
        failed: ": Failed",
        uncertain: ": Not confirmed",
    }[incident.outcome]
    return `${what}${result}`
}
const lockdownText: Record<AntiNukeIncident["lockdown"], string> = {
    none: "",
    "not-allowed": "Wanted, but not allowed",
    started: "Started",
    "already-on": "Already on",
    failed: "Could not start",
}
const kindText: Record<AntiNukeIncident["actorKind"], string> = {
    staff: "",
    bot: " (bot)",
    high: " (ranked at or above NeonFlux)",
    owner: " (owner)",
    trusted: " (trusted)",
}
/** One incident on one line */
const incidentLine = (incident: AntiNukeIncident) =>
    `#${incident.incidentNo} ${ago(incident.createdAt)}: ${format.userMention(incident.actorId)}${kindText[incident.actorKind]}. ${ruleText(incident)}. ${responseText(incident)}`
/** One incident: What was observed, what was done and how to undo it */
export function incidentCard(incident: AntiNukeIncident, prefix: string): Card {
    const observed = Object.entries(incident.counts)
        .map(([action, count]) => `${count} ${action}`)
        .join(", ")
    const restorable = antiNukeRestorable(incident)
    return {
        title: `Anti-nuke incident ${incident.incidentNo}`,
        description: `${format.userMention(incident.actorId)}${kindText[incident.actorKind]}: ${ruleText(incident)}`,
        fields: [
            ["Observed", observed || "None"],
            ["Window", `${ago(incident.firstAt)} to ${ago(incident.lastAt)}`],
            ["Response", responseText(incident)],
            ...(incident.removedRoleIds.length
                ? [["Roles", incident.removedRoleIds.map((id) => format.roleMention(id)).join(", ")] as const]
                : []),
            ...(lockdownText[incident.lockdown] ? [["Lockdown", lockdownText[incident.lockdown]] as const] : []),
            ...(incident.restoreOutcome
                ? [
                      [
                          "Restore",
                          incident.restoreOutcome === "succeeded"
                              ? `${`Done ${incident.restoredAt ? ago(incident.restoredAt) : ""}`.trim()}${incident.restoreGoneRoleIds?.length ? `. ${incident.restoreGoneRoleIds.length === 1 ? "One role was" : `${incident.restoreGoneRoleIds.length} roles were`} deleted since` : ""}`
                              : incident.restoreOutcome === "failed"
                                ? `Not finished${incident.restoreLeftRoleIds?.length ? `: ${incident.restoreLeftRoleIds.map((id) => format.roleMention(id)).join(", ")} ranks at or above NeonFlux` : ""}`
                                : "Not confirmed",
                      ] as const,
                  ]
                : []),
        ],
        ...(restorable
            ? { note: `Give the roles back with ${code(`${prefix}antinuke restore <@${incident.actorId}>`)}` }
            : {}),
    }
}
export function antiNukeCard(settings: AntiNukeSettings, prefix: string): Card {
    return {
        title: "Anti-nuke",
        description: settings.enabled
            ? settings.mode === "enforce"
                ? "On and acting on what it finds"
                : "On in dry-run: It records and alerts only"
            : "Off",
        fields: [
            ["Response", settings.response],
            ["Limits", limitText(settings.limits)],
            ["Lockdown", onOff(settings.lockdown)],
            ...(settings.trustedIds.length ? [["Trusted", String(settings.trustedIds.length)] as const] : []),
        ],
        note: settings.enabled
            ? `See what it found with ${code(`${prefix}antinuke incidents`)}. It cannot stop the owner or anyone ranked above NeonFlux, and only alerts about them`
            : `Turn it on with ${code(`${prefix}antinuke module on`)}. It starts in dry-run`,
    }
}

/** What NeonFlux lacks for what a setting asks of it, read fresh. It says so and still saves the setting */
const lacking = (client: Client, serverId: string, settings: AntiNukeSettings) =>
    Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const { botServerPermissions: held } = yield* readSafetyAuthority(client, serverId, botId)
        const needed =
            Permissions.ViewAuditLog |
            (settings.mode === "enforce"
                ? settings.response === "strip"
                    ? Permissions.ManageRoles | Permissions.KickMembers
                    : settings.response === "kick"
                      ? Permissions.KickMembers
                      : Permissions.BanMembers
                : 0n) |
            (settings.mode === "enforce" && settings.lockdown ? Permissions.ManageRoles : 0n)
        return needed & ~held
    }).pipe(Effect.catch(() => Effect.succeed(0n)))

/** What a restore did, naming every role that stayed out and why */
export function restoreReply(
    userId: string,
    incidentNo: number,
    done: {
        readonly written: "succeeded" | "failed" | "uncertain"
        readonly restored: number
        readonly above: readonly string[]
        readonly deleted: readonly string[]
    },
) {
    if (done.written === "failed")
        return "Fluxer refused to give the roles back. Check that NeonFlux has Manage roles and ranks above them, then try again"
    if (done.written === "uncertain")
        return "NeonFlux could not confirm the roles came back. Send this command again, since it reads the member first"
    const parts = [
        done.restored
            ? `${format.userMention(userId)} has ${done.restored} ${done.restored === 1 ? "role" : "roles"} back from incident ${incidentNo}`
            : done.above.length || done.deleted.length
              ? `${format.userMention(userId)} got no role back from incident ${incidentNo}`
              : `${format.userMention(userId)} already holds what incident ${incidentNo} removed`,
        ...(done.above.length
            ? [
                  `${done.above.map((id) => format.roleMention(id)).join(", ")} ${done.above.length === 1 ? "ranks" : "rank"} at or above NeonFlux. Move NeonFlux above and send this again`,
              ]
            : []),
        ...(done.deleted.length
            ? [`${done.deleted.length === 1 ? "One role was" : `${done.deleted.length} roles were`} deleted since`]
            : []),
    ]
    return parts.join(". ")
}

export function handleAntiNukeCommand(
    store: AntiNukeStore | undefined,
    runtime: AntiNukeRuntime | undefined,
    config: BotConfig,
    args: readonly string[],
    context: BotEventContext<"messageCreate">,
) {
    const prefix = replyPrefix(config.serverId, context.message.guildId),
        reply = (content: string) => replyText(context, withPrefix(content, prefix))
    return Effect.gen(function* () {
        const { message, client } = context,
            serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store || !runtime) {
            yield* reply(notSetUp("Anti-nuke"))
            return
        }
        const command = parseAntiNukeCommand(args)
        if ("error" in command) {
            yield* reply(command.error)
            return
        }
        if (command.type === "help") {
            yield* reply(antinukeHelp)
            return
        }
        const { authority, actor } = yield* readServerManager(client, serverId, message.author.id)
        if (!authority.isOwner && !authority.isAdmin) {
            yield* reply(ownerOnly)
            return
        }
        if (command.type === "status") {
            yield* replyCard(context, serverId, antiNukeCard(runtime.settings(), prefix))
            return
        }
        if (command.type === "trust-list") {
            const ids = runtime.settings().trustedIds,
                key = pageKey(serverId, message, "antinuke", "trust"),
                next = command.next ? nextPosition<number>(key) : 1
            if (next === undefined) {
                yield* reply(noNextPage("!antinuke trust list"))
                return
            }
            const pages = Math.max(1, Math.ceil(ids.length / PAGE)),
                page = Math.min(next, pages)
            rememberPosition(key, page < pages ? page + 1 : undefined)
            yield* replyCard(context, serverId, {
                title: "Trusted accounts",
                description: ids.length
                    ? ids
                          .slice((page - 1) * PAGE, page * PAGE)
                          .map((id) => format.userMention(id))
                          .join("\n")
                    : "None yet",
                ...(page < pages ? { fields: [["Next", code(`${prefix}antinuke trust list next`)] as const] } : {}),
            })
            return
        }
        if (command.type === "incidents") {
            const key = pageKey(serverId, message, "antinuke", "incidents"),
                before = command.next ? nextPosition<number>(key) : 0
            if (before === undefined) {
                yield* reply(noNextPage("!antinuke incidents"))
                return
            }
            const { incidents, more } = yield* store.incidents({
                serverId,
                actor,
                query: { type: "page", ...(before ? { before } : {}) },
            })
            rememberPosition(key, more ? incidents.at(-1)!.incidentNo : undefined)
            yield* replyCard(context, serverId, {
                title: "Anti-nuke incidents",
                description: incidents.length ? incidents.map(incidentLine).join("\n") : "None yet",
                ...(more ? { fields: [["Next", code(`${prefix}antinuke incidents next`)] as const] } : {}),
                ...(incidents.length ? { note: `See one with ${code(`${prefix}antinuke incident <number>`)}` } : {}),
            })
            return
        }
        if (command.type === "incident") {
            const read = () =>
                store.incidents({ serverId, actor, query: { type: "one", incidentNo: command.incidentNo } })
            const found = (yield* read()).incidents[0]
            if (!found) {
                yield* reply("This server has no incident with that number. Check !antinuke incidents")
                return
            }
            // An unknown outcome settles from a read of the exact member, and nothing is sent again
            if (found.outcome === "uncertain") {
                const outcome = yield* readIncidentOutcome(client, serverId, found)
                if (outcome) {
                    yield* store.finish({ serverId, incidentNo: found.incidentNo, outcome })
                    yield* replyCard(context, serverId, incidentCard({ ...found, outcome }, prefix))
                    return
                }
            }
            yield* replyCard(context, serverId, incidentCard(found, prefix))
            return
        }
        const createdAt = yield* sourceTimestamp(message)
        const manage = (operation: Parameters<AntiNukeStore["manage"]>[0]["operation"]) =>
            store.manage({ serverId, originServerId: serverId, messageId: message.id, createdAt, actor, operation })
        if (command.type === "restore") {
            const incident = (yield* store.incidents({
                serverId,
                actor,
                query: { type: "restorable", userId: command.userId },
            })).incidents[0]
            if (!incident) {
                yield* reply("No incident holds roles to give back to this member. Check !antinuke incidents")
                return
            }
            const done = yield* restoreIncidentRoles(client, serverId, incident)
            if (done.kind === "absent") {
                yield* reply("That member is not in this server, so NeonFlux cannot give the roles back")
                return
            }
            yield* manage({
                type: "restore",
                userId: command.userId,
                result: {
                    incidentNo: incident.incidentNo,
                    outcome: done.outcome,
                    ...(done.above.length ? { left: done.above } : {}),
                    ...(done.deleted.length ? { gone: done.deleted } : {}),
                },
            })
            if (done.written === "succeeded") yield* runtime.forget(command.userId)
            yield* reply(restoreReply(command.userId, incident.incidentNo, done))
            return
        }
        const result = yield* manage(command)
        yield* runtime.changed(result.settings)
        const missing =
            result.settings.enabled &&
            (command.type === "module" ||
                command.type === "mode" ||
                command.type === "lockdown" ||
                command.type === "response")
                ? yield* lacking(client, serverId, result.settings)
                : 0n
        const fix = missing ? `. ${fixSentence({ permissions: permissionNames(missing) })}` : ""
        const said = {
            module: () => (result.settings.enabled ? `Anti-nuke on in ${result.settings.mode}` : "Anti-nuke off"),
            mode: () =>
                result.settings.mode === "enforce"
                    ? `Anti-nuke now acts: ${result.settings.response}. It cannot stop the owner or anyone ranked above NeonFlux`
                    : "Anti-nuke now records and alerts only",
            limit: () =>
                command.type === "limit"
                    ? `Anti-nuke's ${command.limit} limit is now ${command.value.count} in ${command.value.seconds} seconds`
                    : "",
            response: () => `Anti-nuke's response is now ${result.settings.response}`,
            lockdown: () =>
                result.settings.lockdown
                    ? "An incident may now start the server-wide lockdown, when stopping one account cannot contain it"
                    : "An incident no longer starts the server-wide lockdown",
            trust: () =>
                command.type === "trust"
                    ? `${format.userMention(command.userId)} ${command.trusted ? "is trusted. Anti-nuke only alerts about them" : "is no longer trusted"}`
                    : "",
        }[command.type]
        yield* reply(`${said()}${fix}`)
    }).pipe(
        Effect.catch((error) => reply(describe(error))),
        Effect.asVoid,
    )
}

/**
 * Native work the website asks for. A restore's comes before the backend records it, since Fluxer holds the roles, and it is bound to the one
 * incident the website showed. A settle reads the exact member and sends nothing
 */
export function prepareAntiNukeDashboardJob(
    client: Client,
    serverId: string,
    job: DashboardConfigurationReadyJob,
    store: AntiNukeStore,
    actor: Parameters<AntiNukeStore["incidents"]>[0]["actor"],
) {
    return Effect.gen(function* () {
        if (job.family !== "antinuke" || (job.operation.type !== "restore" && job.operation.type !== "settle"))
            return undefined
        const op = job.operation
        const incident = (yield* store.incidents({
            serverId,
            actor,
            query: { type: "one", incidentNo: op.incidentNo },
        })).incidents[0]
        if (op.type === "settle") {
            if (incident?.outcome === "uncertain") {
                const outcome = yield* readIncidentOutcome(client, serverId, incident)
                if (outcome) yield* store.finish({ serverId, incidentNo: incident.incidentNo, outcome })
            }
            return undefined
        }
        if (!incident || !antiNukeRestorable(incident))
            return yield* Effect.fail(
                new AntiNukeHandlingError({ problem: "That incident no longer holds roles to give back" }),
            )
        const done = yield* restoreIncidentRoles(client, serverId, incident)
        if (done.kind === "absent")
            return yield* Effect.fail(
                new AntiNukeHandlingError({
                    problem: "That member is not in this server, so the roles cannot come back",
                }),
            )
        if (done.written === "succeeded") yield* antiNukeRuntimes.get(serverId)?.forget(incident.actorId) ?? Effect.void
        return {
            context: {
                result: {
                    incidentNo: incident.incidentNo,
                    outcome: done.outcome,
                    ...(done.above.length ? { left: done.above } : {}),
                    ...(done.deleted.length ? { gone: done.deleted } : {}),
                },
            },
            undo: Effect.void,
        }
    })
}
