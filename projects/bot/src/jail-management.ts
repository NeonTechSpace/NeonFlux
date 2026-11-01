import type { DashboardConfigurationReadyJob } from "@neonflux/contracts/dashboard"
import type { JailEntry, JailStatus } from "@neonflux/contracts/jail"
import { errors, format, Permissions, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import { refusedReason } from "./backend-http.ts"
import type { BotConfig } from "./config.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { jailHelp, parseJailCommand } from "./jail-command.ts"
import { jailSettingsOf } from "./jail-memory.ts"
import { JailHandlingError, prepareJailSetup, readJailRole } from "./jail-permissions.ts"
import { JailStoreError, type JailStore } from "./jail-store.ts"
import type { JailRuntime } from "./jail-worker.ts"
import { moderationActor, privateChannel } from "./moderation.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { fixSentence, nativeFix, permissionNames } from "./permission-fix.ts"
import { ago, at, code, notSetUp, replyCard, replyText, sendCard, type Card } from "./reply-style.ts"
import { sourceTimestamp } from "./responses.ts"
import { channelViewerRoles, readSafetyAuthority, SafetyPermissionError } from "./safety-permissions.ts"

export class JailDashboardError extends Data.TaggedError("JailDashboardError")<{ readonly problem: string }> {}

const adminOnly = "Only the server owner or an Administrator can change jail"
function describe(error: unknown) {
    if (error instanceof JailStoreError) {
        const refused = refusedReason(error)
        if (refused) return refused
        if (error.status === 403) return "Only the owner, Administrators and moderation staff can use this"
        return "Jail is unavailable right now. Try again shortly"
    }
    if (error instanceof JailHandlingError)
        return error.stage === "permissions"
            ? `NeonFlux cannot set up jail yet. ${fixSentence({ permissions: permissionNames(Permissions.ManageRoles | Permissions.ManageChannels) })}`
            : error.stage === "role"
              ? "The jail role must rank below NeonFlux and carry no permissions. Fix it or name another with !jail role"
              : "NeonFlux cannot find that channel in this server. Check it and try again"
    if (error instanceof SafetyPermissionError)
        return error.stage === "channel" || error.operation === "channel"
            ? "NeonFlux cannot find that channel in this server. Check it and try again"
            : "Current permissions could not be read. Try again shortly"
    const fix = nativeFix(error)
    return fix ? `Fluxer refused the request. ${fix}` : "The command could not be completed. Check !jail status"
}
const stateText: Record<JailEntry["state"], string> = {
    jailing: "Being jailed",
    active: "Jailed",
    "jail-uncertain": "Jail not confirmed",
    releasing: "Being released",
    "release-uncertain": "Release not confirmed",
}
const entryLine = (entry: JailEntry) =>
    `${format.userMention(entry.userId)}: ${stateText[entry.state]}, case #${entry.caseNo}, ${
        entry.releaseAt !== undefined ? `until ${at(entry.releaseAt)}` : `since ${ago(entry.createdAt)}`
    }`
/** The status card: Whether jail is on, its role and channel, how far setup got and the channels it could not change */
export function jailCard(status: JailStatus, prefix: string, gone: { role?: boolean; channel?: boolean } = {}): Card {
    const { settings, setup } = status
    const missing = gone.role || gone.channel
    const problems = setup?.problems.map(
        (problem) =>
            `${format.channelMention(problem.channelId)}: ${problem.state === "uncertain" ? "Not confirmed" : "Failed"}`,
    )
    return {
        title: "Jail",
        description: settings.enabled ? "On" : "Off. Members already jailed stay jailed",
        fields: [
            ["Role", gone.role ? "Deleted" : settings.roleId ? format.roleMention(settings.roleId) : "None"],
            [
                "Channel",
                gone.channel ? "Deleted" : settings.channelId ? format.channelMention(settings.channelId) : "None",
            ],
            ["Jailed", String(status.count)],
            ...(setup
                ? [
                      [
                          "Setup",
                          setup.state === "running"
                              ? `Running, ${setup.done} of ${setup.total} channels`
                              : `${setup.done} of ${setup.total} channels`,
                      ] as const,
                  ]
                : []),
            ...(problems?.length
                ? [
                      [
                          "Could not change",
                          `${problems.join("\n")}${setup!.moreProblems ? `\nAnd ${setup!.moreProblems} more` : ""}`,
                      ] as const,
                  ]
                : []),
        ],
        note: missing
            ? `The jail ${gone.role ? "role" : "channel"} is gone. ${code(`${prefix}jail setup`)} makes new ones`
            : problems?.length
              ? `Fix what stopped them, then run ${code(`${prefix}jail setup`)}, which reads each channel first and repeats only what is missing`
              : !settings.roleId
                ? `Start with ${code(`${prefix}jail setup`)}`
                : settings.enabled
                  ? `Jail a member with ${code(`${prefix}mod jail @member [length] [reason]`)}`
                  : `Turn it on with ${code(`${prefix}jail module on`)}`,
    }
}

export function handleJailCommand(
    store: JailStore | undefined,
    runtime: JailRuntime | undefined,
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
            yield* reply(notSetUp("Jail"))
            return
        }
        const command = parseJailCommand(args)
        if ("error" in command) {
            yield* reply(command.error)
            return
        }
        if (command.type === "help") {
            yield* reply(jailHelp)
            return
        }
        // Who is jailed follows the rule of private cases, so the list reads the channel it was asked in
        const authority = yield* readSafetyAuthority(
            client,
            serverId,
            message.author.id,
            command.type === "list" ? { channelId: message.channelId } : {},
        )
        const actor = moderationActor(authority)
        if (command.type === "status") {
            const status = yield* store.status({ serverId, actor })
            // Read fresh, since someone may have deleted either by hand
            const { roleId, channelId } = status.settings
            const channelGone = channelId
                ? yield* client.channels.fetch(channelId, { timeoutMs: 5000 }).pipe(
                      Effect.as(false),
                      Effect.catch((error) => Effect.succeed(errors.isNotFound(error))),
                  )
                : false
            yield* replyCard(
                context,
                serverId,
                jailCard(status, prefix, {
                    role: !!roleId && !authority.roles.some((role) => role.id === roleId),
                    channel: channelGone,
                }),
            )
            return
        }
        if (command.type === "list") {
            const key = pageKey(serverId, message, "jail", "list"),
                after = command.next ? nextPosition<string>(key) : ""
            if (after === undefined) {
                yield* reply(noNextPage("!jail list"))
                return
            }
            const viewers = channelViewerRoles(authority)
            const staff = viewers?.length ? (yield* store.memory({ serverId })).moderationRoleIds : []
            const staffChannel = viewers !== undefined && viewers.every((id) => staff.includes(id))
            const dm = staffChannel ? undefined : yield* privateChannel(client, message.author.id)
            const page = yield* store.list({
                serverId,
                originServerId: serverId,
                actor,
                ...(dm ? { privateChannelVerified: true } : { staffChannelRoleIds: viewers! }),
                ...(after ? { afterUserId: after } : {}),
            })
            rememberPosition(key, page.nextAfterUserId)
            const card: Card = {
                title: "Jailed members",
                description: page.entries.length ? page.entries.map(entryLine).join("\n") : "None",
                ...(page.nextAfterUserId
                    ? { note: `Send ${code(`${prefix}jail list next`)} in the server for the next page` }
                    : {}),
            }
            if (dm) {
                yield* sendCard(client, dm, config, card)
                yield* reply("Details sent by DM, since members who may not read them can see this channel")
            } else yield* replyCard(context, serverId, card)
            return
        }
        if (!authority.isOwner && !authority.isAdmin) {
            yield* reply(adminOnly)
            return
        }
        const createdAt = yield* sourceTimestamp(message)
        const manage = (operation: Parameters<JailStore["manage"]>[0]["operation"]) =>
            store.manage({ serverId, originServerId: serverId, messageId: message.id, createdAt, actor, operation })
        if (command.type === "module") {
            const { settings } = yield* manage(command)
            yield* runtime.changed(settings)
            yield* reply(
                settings.enabled
                    ? "Jail is on"
                    : "Jail is off. Members already jailed stay jailed, and !mod unjail still releases them",
            )
            return
        }
        if (command.type === "role") {
            const problem = yield* readJailRole(client, serverId, command.roleId)
            if (problem) {
                yield* reply(problem)
                return
            }
            const { settings } = yield* manage(command)
            yield* runtime.changed(settings)
            yield* reply(`Jail role: ${format.roleMention(command.roleId)}. ${code("!jail status")} shows the channels`)
            return
        }
        if (command.type === "channel") {
            yield* readSafetyAuthority(client, serverId, message.author.id, { channelId: command.channelId })
            const { settings } = yield* manage(command)
            yield* runtime.changed(settings)
            yield* reply(
                `Jail channel: ${format.channelMention(command.channelId)}. ${code("!jail status")} shows the channels`,
            )
            return
        }
        const made = yield* prepareJailSetup(client, serverId, jailSettingsOf(serverId), command.channelId)
        const { settings } = yield* manage({ type: "setup", roleId: made.roleId, channelId: made.channelId }).pipe(
            Effect.tapError(() => made.undo),
        )
        yield* runtime.changed(settings, true)
        yield* reply(
            `Jail on with ${format.roleMention(made.roleId)} and ${format.channelMention(made.channelId)}. NeonFlux is denying the role every other channel, one at a time. Check ${code("!jail status")}`,
        )
    }).pipe(
        Effect.catch((error) => reply(describe(error))),
        Effect.asVoid,
    )
}

/** Native work a dashboard jail job needs: The role and channel a setup finds or makes, and a role's check before it is saved */
export function prepareJailDashboardJob(client: Client, serverId: string, job: DashboardConfigurationReadyJob) {
    return Effect.gen(function* () {
        if (job.family !== "jail") return undefined
        if (job.operation.type === "role") {
            const problem = yield* readJailRole(client, serverId, job.operation.roleId)
            if (problem) return yield* new JailDashboardError({ problem })
            return undefined
        }
        if (job.operation.type !== "setup") return undefined
        const made = yield* prepareJailSetup(client, serverId, jailSettingsOf(serverId), job.operation.channelId)
        return { context: { jailSetup: { roleId: made.roleId, channelId: made.channelId } }, undo: made.undo }
    })
}
