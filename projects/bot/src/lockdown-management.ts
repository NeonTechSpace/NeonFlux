import {
    LOCKDOWN_PROBLEM_LIMIT,
    type LockdownPlan,
    type LockdownStatus,
    type LockdownView,
} from "@neonflux/contracts/lockdown"
import type { DashboardConfigurationReadyJob } from "@neonflux/contracts/dashboard"
import { format, Permissions, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { lockdownHelp, parseLockdownCommand } from "./lockdown-command.ts"
import { readLockdownPlan } from "./lockdown-permissions.ts"
import { LockdownStoreError, type LockdownStore } from "./lockdown-store.ts"
import { lockdownRuntimes, settleLockdown, type LockdownRuntime } from "./lockdown-worker.ts"
import { moderationActor } from "./moderation.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { fixSentence, nativeFix, permissionNames } from "./permission-fix.ts"
import { ago, code, notSetUp, replyCard, replyText, type Card } from "./reply-style.ts"
import { sourceTimestamp } from "./responses.ts"
import { readSafetyAuthority, SafetyPermissionError } from "./safety-permissions.ts"

export class LockdownHandlingError extends Data.TaggedError("LockdownHandlingError")<{
    readonly problem: string
}> {}

const staffOnly = "Only the server owner, Administrators and security staff with Manage roles can use lockdown"
const EXEMPT_PAGE = 10
function describe(error: unknown) {
    if (error instanceof LockdownStoreError) {
        if (error.status === 403) return staffOnly
        if (error.status === 429) return "A lockdown can exempt at most 500 channels. Remove one first"
        if (error.status === 409)
            return "Lockdown settings changed on the website while this command ran. Check !lockdown status and try again"
        return "Lockdown is unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError)
        return error.stage === "channel" || error.operation === "channel"
            ? "NeonFlux cannot find that channel in this server. Check it and try again"
            : "Current permissions could not be read. Try again shortly"
    const fix = nativeFix(error)
    return fix ? `Fluxer refused the request. ${fix}` : "The command could not be completed. Check !lockdown status"
}
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`
const stateText: Record<LockdownView["state"], string> = {
    locking: "On, still locking channels",
    active: "On",
    restoring: "Being lifted, still restoring channels",
    ended: "Off",
}
/** The status card: The state first, then counts and at most 10 problem channels */
export function lockdownCard(status: LockdownStatus, prefix: string): Card {
    const row = status.lockdown,
        exempt = status.settings.exemptChannelIds.length
    if (!row)
        return {
            title: "Lockdown",
            description: "Off. No lockdown has run in this server",
            ...(exempt ? { fields: [["Exempt", String(exempt)] as const] } : {}),
            note: `Start one with ${code(`${prefix}lockdown on [reason]`)}`,
        }
    const c = row.counts,
        busy = c.queued + c.writing
    const problems = row.problems
        .slice(0, LOCKDOWN_PROBLEM_LIMIT)
        .map(
            (problem) =>
                `${format.channelMention(problem.channelId)}: ${problem.state === "uncertain" ? "Uncertain" : "Failed"}`,
        )
    const on = row.state === "locking" || row.state === "active"
    return {
        title: "Lockdown",
        description: stateText[row.state],
        fields: [
            ["Started", `${ago(row.startedAt)} by ${row.startedBy ? format.userMention(row.startedBy) : "anti-nuke"}`],
            ...(row.reason ? [["Reason", row.reason] as const] : []),
            ["Locked", String(c.locked)],
            ...(busy ? [["Waiting", String(busy)] as const] : []),
            ...(c.restored ? [["Restored", String(c.restored)] as const] : []),
            ...(c.failed ? [["Failed", String(c.failed)] as const] : []),
            ...(c.uncertain ? [["Uncertain", String(c.uncertain)] as const] : []),
            ...(problems.length ? [["Problems", problems.join("\n")] as const] : []),
        ],
        note: c.failed
            ? `Fix what stopped them, then send ${code(`${prefix}lockdown ${on ? "on" : "off"}`)} again to repeat those channels`
            : c.uncertain
              ? "NeonFlux reads each uncertain channel with this command and never repeats a write on its own"
              : on
                ? `Lift it with ${code(`${prefix}lockdown off`)}`
                : `Start one with ${code(`${prefix}lockdown on [reason]`)}`,
    }
}

/** What a new lockdown did and why channels stayed out. A lockdown of nothing during a raid must say so plainly */
const lockdownStarted = (queued: number, skipped: number, plan: LockdownPlan, stillPost: number) => {
    const held = plan.filter((row) => row.skip === "held").length,
        hidden = plan.filter((row) => row.skip === "private").length,
        exempt = Math.max(0, skipped - held - hidden)
    const why = [
        ...(hidden ? [`${hidden} only staff can see`] : []),
        ...(held ? [`${held} already denied`] : []),
        ...(exempt ? [`${exempt} exempt`] : []),
    ]
    return (
        `Lockdown on: ${plural(queued, "channel")} being locked${why.length ? `, left alone: ${why.join(", ")}` : ""}. ` +
        (stillPost
            ? `${plural(stillPost, "channel")} ${stillPost === 1 ? "gives" : "give"} a role its own allow for Send messages, so its members can still post there. `
            : "") +
        "Check !lockdown status"
    )
}

export function handleLockdownCommand(
    store: LockdownStore | undefined,
    runtime: () => LockdownRuntime | undefined,
    config: BotConfig,
    args: readonly string[],
    context: BotEventContext<"messageCreate">,
    notifyMetadata: () => Effect.Effect<void>,
) {
    const prefix = replyPrefix(config.serverId, context.message.guildId),
        reply = (content: string) => replyText(context, withPrefix(content, prefix))
    return Effect.gen(function* () {
        const { message, client } = context,
            serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store) {
            yield* reply(notSetUp("Lockdown"))
            return
        }
        const command = parseLockdownCommand(args)
        if ("error" in command) {
            yield* reply(command.error)
            return
        }
        if (command.type === "help") {
            yield* reply(lockdownHelp)
            return
        }
        // The same rule as !security lock: The member's native permission here, and the backend's staff check
        const authority = yield* readSafetyAuthority(client, serverId, message.author.id, {
            permission: Permissions.ManageRoles,
            ...(command.type === "exempt" && command.exempt ? { channelId: command.channelId } : {}),
        })
        const actor = moderationActor(authority)
        if (command.type === "status") {
            const before = yield* store.get({ serverId, actor })
            const settled = before.lockdown?.counts.uncertain
                ? yield* settleLockdown(store, client, serverId, notifyMetadata)
                : 0
            yield* replyCard(
                context,
                serverId,
                lockdownCard(settled ? yield* store.get({ serverId, actor }) : before, prefix),
            )
            return
        }
        if (command.type === "exempt-list") {
            const { settings } = yield* store.get({ serverId, actor }),
                key = pageKey(serverId, message, "lockdown", "exempt"),
                next = command.next ? nextPosition<number>(key) : 1
            if (next === undefined) {
                yield* reply(noNextPage("!lockdown exempt list"))
                return
            }
            const ids = settings.exemptChannelIds,
                pages = Math.max(1, Math.ceil(ids.length / EXEMPT_PAGE)),
                page = Math.min(next, pages)
            rememberPosition(key, page < pages ? page + 1 : undefined)
            yield* replyCard(context, serverId, {
                title: "Lockdown exempt channels",
                description: ids.length
                    ? ids
                          .slice((page - 1) * EXEMPT_PAGE, page * EXEMPT_PAGE)
                          .map((id) => format.channelMention(id))
                          .join("\n")
                    : "None yet",
                ...(page < pages ? { fields: [["Next", code(`${prefix}lockdown exempt list next`)] as const] } : {}),
            })
            return
        }
        const createdAt = yield* sourceTimestamp(message)
        const manage = (operation: Parameters<LockdownStore["manage"]>[0]["operation"]) =>
            store.manage({
                serverId,
                originServerId: serverId,
                messageId: message.id,
                createdAt,
                actor,
                operation,
            })
        if (command.type === "exempt") {
            yield* manage({ type: "exempt", channelId: command.channelId, exempt: command.exempt })
            yield* reply(
                `${format.channelMention(command.channelId)} ${command.exempt ? "stays out of the next lockdown" : "is no longer exempt"}. A lockdown already on is not changed`,
            )
            return
        }
        if (command.type === "on") {
            const { plan, canWrite, stillPostIds } = yield* readLockdownPlan(client, serverId)
            if (!canWrite) {
                yield* reply(
                    `NeonFlux cannot lock channels yet. ${fixSentence({ permissions: permissionNames(Permissions.ManageRoles) })}`,
                )
                return
            }
            const result = yield* manage({
                type: "on",
                ...(command.reason ? { reason: command.reason } : {}),
                plan,
            })
            if (result.admitted) yield* notifyMetadata()
            yield* runtime()?.notify() ?? Effect.void
            const c = result.lockdown?.counts
            // Exempt channels stay open on purpose, so they do not count among those a role can still post in. The lockdown has started, so a
            // failed read only leaves them counted
            const exemptIds = stillPostIds.length
                ? yield* store.get({ serverId, actor }).pipe(
                      Effect.map((status) => status.settings.exemptChannelIds),
                      Effect.orElseSucceed((): readonly string[] => []),
                  )
                : []
            const stillPost = stillPostIds.filter((id) => !exemptIds.includes(id))
            yield* reply(
                result.refused === "already-on"
                    ? "A lockdown is already on. Check !lockdown status"
                    : result.refused === "restoring"
                      ? "The last lockdown is still being lifted. Check !lockdown status and try again"
                      : result.refused === "unrestored"
                        ? "The last lockdown left channels it could not restore. Send !lockdown off to repeat them first, since only NeonFlux's record of them knows what to give back"
                        : result.requeued !== undefined
                          ? `A lockdown is already on, so NeonFlux tries the ${plural(result.requeued, "failed channel")} again. Check !lockdown status`
                          : lockdownStarted(c?.queued ?? 0, c?.skipped ?? 0, plan, stillPost.length),
            )
            return
        }
        const result = yield* manage({ type: "off", ...(command.reason ? { reason: command.reason } : {}) })
        if (result.admitted) yield* notifyMetadata()
        yield* runtime()?.notify() ?? Effect.void
        const c = result.lockdown?.counts
        yield* reply(
            result.refused === "not-on"
                ? "No lockdown is on. Check !lockdown status"
                : result.ended
                  ? "Lockdown off. No channel had anything to restore"
                  : `Lockdown lifting: ${plural(c?.queued ?? 0, "channel")} being restored. Channels locked with !security lock stay locked. Check !lockdown status`,
        )
    }).pipe(
        Effect.catch((error) => reply(describe(error))),
        Effect.asVoid,
    )
}

/** Native work a dashboard lockdown job needs: The channels as the bot reads them now, or a fresh read of the uncertain ones */
export function prepareLockdownDashboardJob(client: Client, serverId: string, job: DashboardConfigurationReadyJob) {
    return Effect.gen(function* () {
        if (job.family !== "lockdown") return undefined
        if (job.operation.type === "settle") yield* lockdownRuntimes.get(serverId)?.settle ?? Effect.void
        if (job.operation.type !== "on") return undefined
        const { plan, canWrite } = yield* readLockdownPlan(client, serverId)
        if (!canWrite)
            return yield* Effect.fail(
                new LockdownHandlingError({
                    problem: `NeonFlux cannot lock channels yet. ${fixSentence({ permissions: permissionNames(Permissions.ManageRoles) })}`,
                }),
            )
        return { context: { plan }, undo: Effect.void }
    })
}
