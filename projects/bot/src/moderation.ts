import type { AppealMemberResult, AppealStaffResult } from "@neonflux/contracts/appeal"
import type {
    ModerationActionContext,
    ModerationActionGrant,
    ModerationActionType,
    ModerationManageOperation,
    ModerationNoticeGrant,
    ModerationQueryResult,
    StaffClass,
} from "@neonflux/contracts/moderation"
import type { ModerationActor } from "@neonflux/contracts/shared"
import {
    errors,
    format,
    hierarchy,
    isThreadChannel,
    permissionBits,
    Permissions,
    type BotEventContext,
    type Client,
} from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit, Semaphore, type Types } from "effect"
import { dmServerHint, serverLabel, serverOption, serverReply } from "./server-scope.ts"
import { actionPermission, executeAction, observeAction, overwriteSnapshot } from "./action-executor.ts"
import type { BotConfig, BotRootConfig } from "./config.ts"
import {
    actionNames,
    appealCard,
    appealCasesCard,
    appealListCard,
    caseResult,
    manageConfirmation,
    queryCard,
    reasonText,
    type SafetyCommandText,
} from "./moderation-format.ts"
import { safetyHelp, type SafetyCommand, type SafetyName } from "./moderation-command.ts"
import { ModerationStoreError, moderationErrorMessage, type ModerationStore } from "./moderation-store.ts"
import { sourceTimestamp } from "./responses.ts"
import {
    channelPermissionInput,
    channelViewerRoles,
    ownedPostingBits,
    readChannels,
    readAuthenticatedBotId,
    readSafetyAuthority,
    restorablePostingBits,
    verifyPrivateAuthor,
    type SafetyAuthority,
} from "./safety-permissions.ts"
import { fixSentence, labelList, permissionNames } from "./permission-fix.ts"
import { replyPrefix, serverReplyStyle, withPrefix } from "./general-settings.ts"
import {
    at,
    code,
    codeBlock,
    duration,
    renderCard,
    replyCard,
    replyText,
    replyTextIds,
    sendCard,
    type Card,
} from "./reply-style.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { warnFailure } from "./contained.ts"

class ModerationHandlingError extends Data.TaggedError("ModerationHandlingError")<{
    readonly stage: "permissions" | "snapshot" | "outcome" | "private-delivery" | "input"
}> {}
export function moderationActor(authority: SafetyAuthority): ModerationActor {
    return {
        originServerId: authority.guild.id,
        userId: authority.actorId,
        roleIds: authority.roleIds,
        isOwner: authority.isOwner,
        isAdministrator: authority.isAdmin,
        nativePermissionAuthorized: authority.nativePermissionAuthorized,
    }
}
export function actionContext(
    authority: SafetyAuthority,
    action?: ModerationActionType,
): Types.Mutable<ModerationActionContext> {
    return {
        originServerId: authority.guild.id,
        botId: authority.botId,
        botActionAuthorized: authority.botPermissionAuthorized,
        actorCanManageTarget: authority.actorCanManageTarget,
        botCanManageTarget: authority.botCanManageTarget,
        targetProtected: authority.targetProtected,
        ...(authority.target?.communicationDisabledUntil !== undefined
            ? { currentTimeoutUntil: authority.target.communicationDisabledUntil }
            : {}),
        ...(authority.channel && (action === "lock" || action === "unlock")
            ? { currentOverwrite: overwriteSnapshot(authority.channel, authority.guild.id) }
            : {}),
        ...(action === "lock" ? { botPostingPermissions: restorablePostingBits(authority.botServerPermissions) } : {}),
        ...(authority.target?.isBot ? { targetBot: true as const } : {}),
        ...(authority.channel &&
        "rateLimitPerUser" in authority.channel &&
        typeof authority.channel.rateLimitPerUser === "number"
            ? { currentSlowmodeSeconds: authority.channel.rateLimitPerUser }
            : {}),
    }
}

const presenceOwners = new WeakMap<
    Client,
    { level: 1 | 2 | 3 | undefined; applied?: string; lock: Semaphore.Semaphore }
>()
// Called on every gated message, so the provider is only contacted when the shown DEFCON state changes.
// Multi mode shows only the configured status, so one server's DEFCON or backend outage never changes the shared presence
export function applyDefconPresence(
    client: Client,
    config: Pick<BotRootConfig, "serverId" | "scope" | "customStatus">,
    level: 1 | 2 | 3 | undefined,
) {
    return Effect.suspend(() => {
        const multi = config.scope?.mode === "multi"
        let owner = presenceOwners.get(client)
        if (!owner) {
            owner = { level: undefined, lock: Semaphore.makeUnsafe(1) }
            presenceOwners.set(client, owner)
        }
        const current = owner
        return current.lock.withPermit(
            Effect.suspend(() => {
                if (!multi) current.level = level
                const unknown = current.level === undefined,
                    restrictive = current.level ?? 1
                const custom = config.customStatus ? { text: config.customStatus } : null
                const presence = multi
                    ? { status: "online" as const, customStatus: custom }
                    : {
                          status: restrictive === 3 ? ("online" as const) : ("dnd" as const),
                          customStatus: unknown ? null : restrictive === 3 ? custom : { text: `DEFCON ${restrictive}` },
                      }
                const key = JSON.stringify(presence)
                if (current.applied === key) return Effect.void
                return client.presence.set(presence).pipe(
                    Effect.tap(() =>
                        Effect.sync(() => {
                            current.applied = key
                        }),
                    ),
                )
            }),
        )
    })
}

// Interrupted actions and deliveries from the previous process become uncertain once at startup
export function initializeModeration(store: ModerationStore, config: BotConfig, client: Client) {
    return store.observe({ serverId: config.serverId }).pipe(
        Effect.flatMap((result) => applyDefconPresence(client, config, result.settings.defcon)),
        Effect.catch(() => applyDefconPresence(client, config, undefined)),
    )
}

// A post Fluxer refused, such as a DM to a member who closed them, did not arrive. Only an unknown result is uncertain
function sendOutcome(operation: Effect.Effect<unknown, unknown>) {
    return Effect.gen(function* () {
        const result = yield* Effect.exit(operation)
        if (Exit.isFailure(result) && Cause.hasInterrupts(result.cause)) return yield* Effect.failCause(result.cause)
        if (Exit.isSuccess(result)) return { outcome: "sent" as const }
        const outcome = errors.outcome(result.cause)
        return {
            outcome:
                outcome === "notDispatched" || outcome === "rejected" ? ("failed" as const) : ("uncertain" as const),
        }
    })
}

/** How the member's notice of a warning, timeout, kick or ban went, as the staff reply reports it */
export type NoticeDelivery = "sent" | "failed" | "uncertain"
const noticeTitles = {
    warn: "Warning in",
    timeout: "Timed out in",
    kick: "Kicked from",
    ban: "Banned from",
} as const
/** Sends the member's notice once. It never fails, so a notice that cannot go out never holds back the sanction beyond the DM's own 5 seconds */
function sendNotice(
    client: Client,
    serverId: string,
    grant: ModerationActionGrant,
    notice: ModerationNoticeGrant,
    config?: BotConfig,
) {
    return Effect.gen(function* () {
        const sent = yield* Effect.exit(
            Effect.gen(function* () {
                if (
                    notice.action !== grant.action ||
                    notice.caseNo !== grant.caseNo ||
                    notice.targetId !== grant.targetId ||
                    notice.reason !== grant.reason
                )
                    return yield* Effect.fail(new ModerationHandlingError({ stage: "outcome" }))
                // The member's notice is a DM, so its commands name the server in multi mode
                const multi = config?.scope?.mode === "multi",
                    option = multi ? ` --server ${serverId}` : ""
                const name = yield* serverLabel(client, serverId)
                const length =
                    notice.action === "timeout" && notice.timeoutUntil
                        ? ` until ${at(Date.parse(notice.timeoutUntil))}`
                        : notice.action === "ban" && notice.durationSeconds
                          ? ` for ${duration(notice.durationSeconds)}`
                          : ""
                const card: Card = {
                    title: `${noticeTitles[notice.action]} ${name}${length}, case #${notice.caseNo}`,
                    description: reasonText(notice.reason),
                    // Members are offered the appeal commands only while the server takes appeals
                    ...(notice.appeals
                        ? {
                              fields: [
                                  [
                                      "Appeal",
                                      `Reply here with ${code(`!appeal${option} submit ${notice.caseNo} <your reason>`)}`,
                                  ],
                                  ["Your cases", `Reply here with ${code(`!appeal${option} cases`)}`],
                              ],
                          }
                        : {}),
                }
                const [body] = renderCard(card, serverReplyStyle(serverId))
                return yield* sendOutcome(
                    client.directMessages.send(
                        notice.targetId,
                        { ...(multi ? serverReply(body!, name) : body!) },
                        { timeoutMs: 5000 },
                    ),
                )
            }),
        )
        if (Exit.isFailure(sent) && Cause.hasInterrupts(sent.cause)) return yield* Effect.failCause(sent.cause)
        return Exit.isSuccess(sent) ? sent.value.outcome : ("uncertain" as const)
    })
}
/** Records a sent notice's outcome once. A failure leaves it pending, which the next start marks not confirmed */
function recordNotice(store: ModerationStore, serverId: string, notice: ModerationNoticeGrant, sent: NoticeDelivery) {
    return Effect.gen(function* () {
        const recorded = yield* Effect.exit(
            store.noticeOutcome({ serverId, noticeId: notice.noticeId, caseNo: notice.caseNo, outcome: sent }),
        )
        if (Exit.isFailure(recorded) && Cause.hasInterrupts(recorded.cause))
            return yield* Effect.failCause(recorded.cause)
    })
}

/** Performs one grant and delivers its staff log and member notice */
function performGrant(
    store: ModerationStore,
    serverId: string,
    actorId: string,
    client: Client,
    grant: ModerationActionGrant,
    config?: BotConfig,
    authority?: SafetyAuthority,
    authorityReadAt?: number,
) {
    return Effect.gen(function* () {
        // A kick or ban claim carries the member's notice, sent before the action because a member who left may be unreachable
        let early: { notice: ModerationNoticeGrant; sent: NoticeDelivery } | undefined
        const confirm = store
            .dispatch({ serverId, actionId: grant.actionId, caseNo: grant.caseNo, dispatch: true })
            .pipe(
                Effect.flatMap((claim) =>
                    claim.notice
                        ? sendNotice(client, serverId, grant, claim.notice, config).pipe(
                              Effect.map((sent) => {
                                  early = { notice: claim.notice!, sent }
                              }),
                          )
                        : Effect.void,
                ),
            )
        // A command's authority is trusted for 15 seconds, so a moderator revoked during a slow reservation never dispatches
        const expired = authorityReadAt !== undefined && (yield* Clock.currentTimeMillis) - authorityReadAt > 15000
        // A grant that stopped being pending is never dispatched and its stored outcome is left alone
        const executed = expired
            ? { outcome: "failed" as const }
            : yield* executeAction(client, serverId, actorId, grant, confirm, authority).pipe(
                  Effect.catch((error) =>
                      error instanceof ModerationStoreError
                          ? Effect.fail(error)
                          : Effect.succeed({ outcome: "failed" as const }),
                  ),
              )
        if (early) yield* recordNotice(store, serverId, early.notice, early.sent)
        const result = yield* store.outcome({ serverId, actionId: grant.actionId, caseNo: grant.caseNo, ...executed })
        if (!result.recorded) return yield* Effect.fail(new ModerationHandlingError({ stage: "outcome" }))
        // Staff type the log post's commands in the server, which needs no selector
        const command: SafetyCommandText = (feature, rest) => `${replyPrefix(serverId, serverId)}${feature} ${rest}`
        const logDelivery = yield* Effect.exit(
            Effect.gen(function* () {
                if (result.log) {
                    const log = result.log
                    const card: Card = {
                        title: `Case #${log.caseNo}: ${actionNames[log.action]}`,
                        fields: [
                            ["Result", caseResult(log, command)],
                            ...(log.targetId ? [["Member", format.userMention(log.targetId)] as const] : []),
                            ["By", format.userMention(actorId)],
                            ["Reason", reasonText(log.reason)],
                            ...(log.durationSeconds ? [["Duration", duration(log.durationSeconds)] as const] : []),
                            ["Details", code(command("mod", `show ${log.caseNo}`))],
                        ],
                    }
                    const sent = yield* sendOutcome(
                        client.messages.send(
                            log.channelId,
                            { ...renderCard(card, serverReplyStyle(serverId))[0]! },
                            { timeoutMs: 5000 },
                        ),
                    )
                    const acknowledged = yield* store.logOutcome({
                        serverId,
                        logId: log.logId,
                        caseNo: log.caseNo,
                        ...sent,
                    })
                    if (!acknowledged.recorded)
                        return yield* Effect.fail(new ModerationHandlingError({ stage: "outcome" }))
                }
            }),
        )
        if (Exit.isFailure(logDelivery) && Cause.hasInterrupts(logDelivery.cause))
            return yield* Effect.failCause(logDelivery.cause)
        // A warning or timeout notice follows the action, since the member stays in the server
        let notice: NoticeDelivery | undefined = early?.sent
        if (result.notice) {
            notice = yield* sendNotice(client, serverId, grant, result.notice, config)
            yield* recordNotice(store, serverId, result.notice, notice)
        }
        return {
            outcome: executed.outcome,
            expired,
            logUncertain: Exit.isFailure(logDelivery),
            ...(notice ? { notice } : {}),
            ...(result.warningPenaltyDue ? { warningPenaltyDue: true as const } : {}),
        }
    })
}
/**
 * A warning that reached the limit: The bot's fresh read of the member, the backend's decision from it, and the resulting grant, which reads
 * Fluxer again like every automated action. A failure leaves no penalty case, so the member's next warning triggers it instead, and never
 * changes the warning's own result
 */
function performWarningPenalty(
    store: ModerationStore,
    serverId: string,
    client: Client,
    warning: ModerationActionGrant,
    config?: BotConfig,
) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const authority = yield* readSafetyAuthority(client, serverId, botId, {
            permission: actionPermission("timeout")!,
            targetId: warning.targetId!,
        })
        const decided = yield* store.warningPenalty({
            serverId,
            actionId: warning.actionId,
            caseNo: warning.caseNo,
            userId: warning.targetId!,
            roleIds: [...(authority.target?.roleIds ?? [])],
            context: actionContext(authority, "timeout"),
        })
        if (!decided.grant) return undefined
        yield* performGrant(store, serverId, botId, client, decided.grant, config)
        return decided.grant.caseNo
    }).pipe(
        Effect.catch((error) =>
            warnFailure("A warning reached the warning limit, but its penalty could not be applied", error).pipe(
                Effect.as(undefined),
            ),
        ),
    )
}
export function performActionGrant(
    store: ModerationStore,
    serverId: string,
    actorId: string,
    client: Client,
    grant: ModerationActionGrant,
    config?: BotConfig,
    authority?: SafetyAuthority,
    authorityReadAt?: number,
) {
    return Effect.gen(function* () {
        const { warningPenaltyDue, ...done } = yield* performGrant(
            store,
            serverId,
            actorId,
            client,
            grant,
            config,
            authority,
            authorityReadAt,
        )
        const penaltyCaseNo =
            warningPenaltyDue && grant.targetId
                ? yield* performWarningPenalty(store, serverId, client, grant, config)
                : undefined
        return { ...done, ...(penaltyCaseNo ? { penaltyCaseNo } : {}) }
    })
}

const threadPermissions = ["SendMessagesInThreads", "CreatePublicThreads", "CreatePrivateThreads"] as const
/** What a lock denied. A thread permission NeonFlux lacks stays open, because unlock could not restore it */
function lockSummary(owned: bigint) {
    const missing = permissionBits.missing(owned, threadPermissions).map(permissionBits.label)
    return missing.length === 0
        ? "The everyone overwrite now denies sending, sending in threads and starting threads"
        : `The everyone overwrite now denies sending${owned === Permissions.SendMessages ? "" : " and the thread permissions NeonFlux holds"}. NeonFlux lacks ${missing.join(", ")} in this server, so those stay open. Grant them to NeonFlux to lock threads too`
}

function privateChannel(client: Client, userId: string, channelId?: string) {
    return Effect.gen(function* () {
        const id = channelId ?? (yield* client.directMessages.open(userId, { timeoutMs: 5000 })).id
        yield* verifyPrivateAuthor(client, id, userId)
        return id
    })
}
function validateReferences(
    command: Extract<SafetyCommand, { kind: "manage" }>,
    authority: SafetyAuthority,
    client: Client,
    serverId: string,
) {
    return Effect.gen(function* () {
        const op = command.operation
        const channelIds: string[] = []
        const roleIds: string[] = []
        if (op.type === "settings") {
            channelIds.push(
                ...(op.patch.honeypotChannelIds ?? []),
                ...(op.patch.logChannelId ? [op.patch.logChannelId] : []),
            )
            roleIds.push(...Object.values(op.patch.staffRoleIds ?? {}).flat())
        }
        if (op.type === "private-role" && op.roleId) roleIds.push(op.roleId)
        if (op.type === "rule-create" || op.type === "rule-update") {
            const rule = op.type === "rule-create" ? op.rule : op.patch
            channelIds.push(...(rule.channelIds ?? []), ...(rule.exemptChannelIds ?? []))
            roleIds.push(...(rule.exemptRoleIds ?? []))
        }
        if (roleIds.some((id) => !authority.roles.some((role) => role.id === id && role.guildId === serverId)))
            return yield* Effect.fail(new ModerationHandlingError({ stage: "input" }))
        const ids = [...new Set(channelIds)]
        const channels = yield* readChannels(client, serverId, ids)
        if (channels.some((channel, index) => channel.id !== ids[index] || channel.guildId !== serverId))
            return yield* Effect.fail(new ModerationHandlingError({ stage: "input" }))
    }).pipe(
        Effect.timeout("5 seconds"),
        Effect.mapError(() => new ModerationHandlingError({ stage: "input" })),
    )
}

/** What to change when the backend refused an action for the bot's or the actor's permissions or rank, from the authority read for it */
function moderationFix(
    code: string | undefined,
    authority: SafetyAuthority,
    action: ModerationActionType,
    client: Client,
) {
    const required = actionPermission(action) ?? 0n
    switch (code) {
        case "BOT_PERMISSION": {
            const botBits = client.permissions.calculate({
                guild: authority.guild,
                member: authority.bot,
                roles: authority.roles,
                ...channelPermissionInput(authority),
            })
            return fixSentence({
                permissions: permissionNames(required & ~botBits || required),
                channelId: authority.channel?.id,
            })
        }
        case "BOT_BELOW_TARGET": {
            const top = authority.target && hierarchy.highestRole(authority.target, authority.roles)
            return top ? fixSentence({ roles: [top.id] }) : "Give NeonFlux a role of its own so it can act on members"
        }
        case "ACTOR_BELOW_TARGET": {
            const top = authority.target && hierarchy.highestRole(authority.target, authority.roles)
            return `Your highest role must rank above ${top ? format.roleMention(top.id) : "this member's highest role"} to act on this member`
        }
        case "ACTOR_PERMISSION":
            return `You need ${labelList(permissionNames(required))} for this action`
        case "TARGET_PROTECTED":
            return "NeonFlux never acts on itself, the server owner, Administrators or the member who sent the command"
        default:
            return undefined
    }
}

/** A list operation that starts at a remembered position: The case, appeal, member or recovery its page continues from, or a page number */
const startAt = <T extends { type: string }>(operation: T, position: number | string | undefined): T =>
    position === undefined
        ? operation
        : {
              ...operation,
              ...(operation.type === "case-list" || operation.type === "cases"
                  ? { beforeCaseNo: position }
                  : operation.type === "list"
                    ? { beforeAppealNo: position }
                    : operation.type === "queue"
                      ? { afterAppealNo: position }
                      : operation.type === "watchlist-list"
                        ? { afterUserId: position }
                        : operation.type === "recovery-list" || operation.type === "case-history"
                          ? { after: position }
                          : { page: position }),
          }
/** Where the page after a list result starts, or undefined after its last page */
const following = (result: ModerationQueryResult | AppealMemberResult | AppealStaffResult) =>
    "nextBeforeCaseNo" in result
        ? result.nextBeforeCaseNo
        : "nextBeforeAppealNo" in result
          ? result.nextBeforeAppealNo
          : "nextAfterAppealNo" in result
            ? result.nextAfterAppealNo
            : "nextAfterUserId" in result
              ? result.nextAfterUserId
              : "nextAfter" in result
                ? result.nextAfter
                : "totalPages" in result && result.page < result.totalPages
                  ? result.page + 1
                  : undefined

/** A purge of everyone waits for the same command once more, within this long of its preview, from the same actor in the same channel */
const purgePreviewMs = 120000
/** What NeonFlux remembers of the purges of everyone in a channel or of an actor is forgotten this long after its last message */
const purgeExchangeMs = 600000
/**
 * How many message IDs of a channel's purge exchange are kept. With more, the oldest drop out and can be counted by a confirm, which
 * spends its count on purge commands and replies and never on anyone else's messages
 */
const purgeExchangeLimit = 20
/** The purge commands of every actor in a channel and the previews, results and errors NeonFlux sent for them, so a confirm never counts them */
interface PurgeExchange {
    ids: string[]
    lastExchangeAt: number
}
/** The latest preview of one actor in a channel, which a confirm repeats and must be newer than the preview reply of, so a confirm typed before the preview was shown never confirms it */
interface PurgeActor {
    pending?: { count: number; reason: string; sentAt: number; replyId: string }
    lastExchangeAt: number
}
const purgeExchanges = new WeakMap<Client, { channels: Map<string, PurgeExchange>; actors: Map<string, PurgeActor> }>()
function rememberExchange(exchange: PurgeExchange, now: number, ...ids: string[]) {
    for (const id of ids) if (!exchange.ids.includes(id)) exchange.ids.push(id)
    exchange.ids.splice(0, Math.max(0, exchange.ids.length - purgeExchangeLimit))
    exchange.lastExchangeAt = now
}

export function handleSafetyCommand(
    store: ModerationStore,
    config: BotConfig,
    name: SafetyName,
    command: SafetyCommand,
    context: BotEventContext<"messageCreate">,
    privateInvocation = false,
) {
    // The authority and action of a backend refusal, so its reply can name the fix
    let refused: { authority: SafetyAuthority; action: ModerationActionType } | undefined
    // The purge exchange of this command, so every reply of its path joins it
    let purgeExchange: PurgeExchange | undefined
    // Replies of the purge path, which join the exchange so a later purge does not count them
    const answer = (context: BotEventContext<"messageCreate">, content: string) =>
        replyTextIds(context, content).pipe(
            Effect.flatMap((ids) =>
                purgeExchange
                    ? Effect.map(Clock.currentTimeMillis, (now) => rememberExchange(purgeExchange!, now, ...ids))
                    : Effect.void,
            ),
        )
    return Effect.gen(function* () {
        const { message, client } = context
        const respond = (content: string) => replyText(context, content)
        const prefix = replyPrefix(config.serverId, message.guildId)
        if (command.kind === "help") {
            yield* respond(withPrefix(safetyHelp(name), prefix))
            return
        }
        const source = { messageId: message.id, createdAt: yield* sourceTimestamp(message) }
        // A follow-up command as the reader types it where it shows. The server's own channels name the server, so only a DM takes the
        // fixed ! and, when the bot serves several servers, --server
        const commandIn =
            (dm: boolean): SafetyCommandText =>
            (feature, rest) =>
                dm ? `!${feature}${serverOption(config)} ${rest}` : `${prefix}${feature} ${rest}`
        const commandText = commandIn(privateInvocation),
            dmText = commandIn(true)
        // A list's next continues where this member's last page of the same list in this channel ended, also when the pages went to a DM
        const page = "page" in command ? command.page : undefined
        const key = page ? pageKey(config.serverId, message, name, page.list) : ""
        const position = page?.next ? nextPosition<number | string>(key) : undefined
        const continued = (card: Card, result: Parameters<typeof following>[0], text: SafetyCommandText): Card => {
            const next = page ? following(result) : undefined
            if (page) rememberPosition(key, next)
            return next === undefined || !page
                ? card
                : { ...card, fields: [...(card.fields ?? []), ["Next", code(`${text(name, page.list)} next`)]] }
        }
        if (command.kind === "member-appeal" && !privateInvocation) {
            yield* respond(
                `Send ${code("!appeal")} commands in a private one-to-one DM with NeonFlux${dmServerHint(config)}`,
            )
            return
        }
        if (page?.next && position === undefined) {
            yield* respond(noNextPage(commandText(name, page.list)))
            return
        }
        if (command.kind === "member-appeal") {
            yield* verifyPrivateAuthor(client, message.channelId, message.author.id)
            const result = yield* store.memberAppeal({
                serverId: config.serverId,
                requesterId: message.author.id,
                originServerId: config.serverId,
                privateChannelVerified: true,
                ...source,
                operation: startAt(command.operation, position),
            })
            if (result.duplicate) return
            const card =
                result.type === "appeal"
                    ? appealCard(result.appeal, false, commandText)
                    : result.type === "appeals"
                      ? appealListCard(result.appeals, false, commandText)
                      : appealCasesCard(result.cases, commandText, result.nextBeforeCaseNo !== undefined)
            yield* sendCard(client, message.channelId, config, continued(card, result, commandText))
            return
        }
        let action = command.kind === "action" ? command.action : undefined
        // Authority is read once per command and reused for the provider action
        let purgeAuthority: SafetyAuthority | undefined
        let purgeReadAt: number | undefined
        if (command.kind === "purge") {
            // A purge is for the server's channel it is sent in, so a DM or another scope cannot name what would be deleted
            if (privateInvocation) {
                yield* respond(`Send ${code("!mod purge")} in the channel whose messages it should delete`)
                return
            }
            purgeAuthority = yield* readSafetyAuthority(client, config.serverId, message.author.id, {
                permission: Permissions.ManageMessages,
                channelId: message.channelId,
            })
            purgeReadAt = yield* Clock.currentTimeMillis
            if (!purgeAuthority.nativePermissionAuthorized) {
                yield* respond(moderationFix("ACTOR_PERMISSION", purgeAuthority, "purge", client)!)
                return
            }
            // Every purge of a staff member joins its channel's exchange, so a later confirm never counts its command or any reply to it.
            // State is added after the staff permission check, and the sweep below drops what was idle for ten minutes, so the maps need no cap
            const state = purgeExchanges.get(client) ?? { channels: new Map(), actors: new Map() }
            purgeExchanges.set(client, state)
            const channelKey = `${config.serverId}:${message.channelId}`
            const actorKey = `${channelKey}:${message.author.id}`
            const now = yield* Clock.currentTimeMillis
            for (const [other, kept] of state.channels)
                if (now - kept.lastExchangeAt >= purgeExchangeMs) state.channels.delete(other)
            for (const [other, kept] of state.actors)
                if (now - kept.lastExchangeAt >= purgeExchangeMs) state.actors.delete(other)
            const exchange = state.channels.get(channelKey) ?? { ids: [], lastExchangeAt: now }
            state.channels.set(channelKey, exchange)
            purgeExchange = exchange
            rememberExchange(exchange, now, message.id)
            const actor = state.actors.get(actorKey) ?? { lastExchangeAt: now }
            actor.lastExchangeAt = now
            state.actors.set(actorKey, actor)
            if (!purgeAuthority.botPermissionAuthorized) {
                yield* answer(context, moderationFix("BOT_PERMISSION", purgeAuthority, "purge", client)!)
                return
            }
            // A purge of everyone runs only when it repeats a preview of the same actor, channel, count and reason that was shown in the
            // last two minutes. It then deletes the newest messages before the confirm, and skips the channel's purge exchange.
            // Anything else stores a new preview once its reply was sent, and does nothing else
            if (!command.userId) {
                const pending = actor.pending
                if (
                    command.confirmed &&
                    pending &&
                    now - pending.sentAt < purgePreviewMs &&
                    pending.count === command.count &&
                    pending.reason === command.reason &&
                    BigInt(message.id) > BigInt(pending.replyId)
                ) {
                    delete actor.pending
                } else {
                    // The moderator's own message, which ends in confirm already when it was one, so sending it again runs it
                    const typed = message.content.trimStart()
                    const again = command.confirmed ? typed : `${typed} confirm`
                    const sent = yield* replyTextIds(
                        context,
                        `No member was named, so this would delete up to ${command.count} recent ${command.count === 1 ? "message" : "messages"} from everyone in this channel. Confirm within 2 minutes\n${/[`\n]/.test(again) ? codeBlock(again) : code(again)}`,
                    )
                    const sentAt = yield* Clock.currentTimeMillis
                    rememberExchange(exchange, sentAt, ...sent)
                    actor.lastExchangeAt = sentAt
                    actor.pending = { count: command.count, reason: command.reason, sentAt, replyId: sent.at(-1)! }
                    return
                }
            }
            const selection = yield* client.messages.previewCleanup(
                message.channelId,
                {
                    maxScanned: 500,
                    maxSelected: command.count,
                    ...(command.userId ? { authorId: command.userId } : {}),
                    filter: (item) =>
                        BigInt(item.id) < BigInt(message.id) &&
                        (command.userId !== undefined || !exchange.ids.includes(item.id)),
                },
                { timeoutMs: 5000 },
            )
            if (!selection.selectedMessages.length) {
                yield* answer(context, "No matching messages were selected")
                return
            }
            action = {
                type: "purge",
                channelId: message.channelId,
                messageIds: selection.selectedMessages.map((item) => item.id),
                ...(command.reason ? { reason: command.reason } : {}),
            }
        }
        // Case and watchlist lookups read the channel they were sent in fresh, since only a staff channel may show their answer
        const lookup =
            !privateInvocation &&
            (command.kind === "history" || command.kind === "recover" || (command.kind === "query" && command.private))
        const authority =
            purgeAuthority ??
            (yield* readSafetyAuthority(client, config.serverId, message.author.id, {
                ...(lookup ? { channelId: message.channelId } : {}),
                ...(action && actionPermission(action.type) !== undefined
                    ? { permission: actionPermission(action.type)! }
                    : {}),
                ...(action?.targetId
                    ? { targetId: action.targetId, allowAbsentTarget: action.type === "ban" || action.type === "unban" }
                    : {}),
                ...(action?.channelId ? { channelId: action.channelId } : {}),
            }))
        const authorityReadAt = purgeReadAt ?? (yield* Clock.currentTimeMillis)
        const actor = moderationActor(authority)
        // A lookup answers where it was asked in a server channel that only Administrators and staff roles allowed this answer can
        // view. A reason posted to members cannot be taken back, so any other server channel gets the answer by DM. A recovery check
        // may need the moderation or security staff as well as the case readers, so its channel needs roles staff in each
        const viewers = lookup ? channelViewerRoles(authority) : undefined
        const scopes: StaffClass[] =
            command.kind === "recover"
                ? name === "security"
                    ? ["security", "moderation"]
                    : ["cases", "security", "moderation"]
                : command.kind === "query" && !command.operation.type.startsWith("case-")
                  ? ["security"]
                  : ["cases"]
        const staffRoles = viewers?.length
            ? yield* store.query({ serverId: config.serverId, actor, operation: { type: "settings" } }).pipe(
                  Effect.map((result) => (result.type === "settings" ? result.settings.staffRoleIds : undefined)),
                  Effect.orElseSucceed(() => undefined),
              )
            : undefined
        const staffChannel =
            viewers !== undefined &&
            viewers.every((id) => scopes.every((scope) => staffRoles?.[scope].includes(id) === true))
        const sentByDm = "Details sent by DM, since members who may not read them can see this channel"
        const verified = (dm: string | undefined) =>
            dm
                ? { originServerId: config.serverId, privateChannelVerified: true }
                : staffChannel
                  ? { originServerId: config.serverId, staffChannelRoleIds: viewers! }
                  : {}
        if (command.kind === "query" || command.kind === "history") {
            const dm =
                (command.kind === "history" || command.private) && !staffChannel
                    ? yield* privateChannel(
                          client,
                          message.author.id,
                          privateInvocation ? message.channelId : undefined,
                      )
                    : undefined
            const operation =
                command.kind === "history"
                    ? startAt({ type: "case-history" as const, caseNo: command.caseNo }, position)
                    : startAt(command.operation, position)
            const result = yield* store.query({
                serverId: config.serverId,
                actor,
                operation,
                ...verified(dm),
            })
            const text = dm ? dmText : commandText
            const card = continued(
                queryCard(result, (command.kind === "query" ? command.view : undefined) ?? name, text),
                result,
                text,
            )
            if (dm) {
                yield* sendCard(client, dm, config, card)
                if (!privateInvocation) yield* respond(sentByDm)
            } else yield* replyCard(context, config.serverId, card)
            return
        }
        if (command.kind === "staff-appeal") {
            const dm = yield* privateChannel(
                client,
                message.author.id,
                privateInvocation ? message.channelId : undefined,
            )
            const result = yield* store.staffAppeal({
                serverId: config.serverId,
                actor,
                originServerId: config.serverId,
                privateChannelVerified: true,
                ...source,
                operation: startAt(command.operation, position),
            })
            if (result.duplicate) return
            yield* sendCard(
                client,
                dm,
                config,
                continued(
                    result.type === "appeal"
                        ? appealCard(result.appeal, true, dmText)
                        : appealListCard(result.appeals, true, dmText, command.operation.type === "queue"),
                    result,
                    dmText,
                ),
            )
            if (!privateInvocation)
                yield* respond(
                    result.type === "appeals"
                        ? "Appeal list sent by DM"
                        : command.operation.type === "decide"
                          ? `Appeal #${result.appeal.appealNo} ${result.appeal.status}. Details sent by DM`
                          : `Appeal #${result.appeal.appealNo} details sent by DM`,
                )
            return
        }
        if (command.kind === "recover") {
            const dm = staffChannel
                ? undefined
                : yield* privateChannel(client, message.author.id, privateInvocation ? message.channelId : undefined)
            const record = yield* store.query({
                serverId: config.serverId,
                actor,
                ...verified(dm),
                operation: { type: name === "security" ? "recovery-case" : "case-show", caseNo: command.caseNo },
            })
            if (record.type !== "case") return yield* Effect.fail(new ModerationHandlingError({ stage: "input" }))
            const recoveryAuthority = yield* readSafetyAuthority(client, config.serverId, message.author.id, {
                ...(actionPermission(record.case.action) !== undefined
                    ? { permission: actionPermission(record.case.action)! }
                    : {}),
                ...(record.case.channelId ? { channelId: record.case.channelId } : {}),
            })
            if (!recoveryAuthority.nativePermissionAuthorized)
                return yield* Effect.fail(new ModerationHandlingError({ stage: "permissions" }))
            const observation = yield* observeAction(client, config.serverId, record.case)
            const result = yield* store.reconcile({
                serverId: config.serverId,
                actor: moderationActor(recoveryAuthority),
                ...verified(dm),
                ...source,
                actionId: record.case.actionId,
                observation,
            })
            if (!result.recorded) return yield* Effect.fail(new ModerationHandlingError({ stage: "outcome" }))
            if (!dm) {
                yield* replyCard(
                    context,
                    config.serverId,
                    queryCard({ type: "case", case: result.case }, name, commandText),
                )
                return
            }
            yield* sendCard(client, dm, config, queryCard({ type: "case", case: result.case }, name, dmText))
            if (!privateInvocation)
                yield* respond(`Case #${result.case.caseNo} checked. Nothing was done again. ${sentByDm}`)
            return
        }
        let operation: ModerationManageOperation
        let checked: ModerationManageOperation | undefined
        if (action && (action.type === "lock" || action.type === "unlock") && isThreadChannel(authority.channel)) {
            // A thread has no overwrites to change. Locking its parent covers posting in its threads
            yield* respond(
                `Threads follow their parent channel's permissions. ${action.type === "lock" ? "Lock" : "Unlock"} ${format.channelMention(authority.channel.parentId)} instead`,
            )
            return
        }
        if (action) {
            const nativeContext = actionContext(authority, action.type)
            if (action.type === "unlock" || action.type === "release") {
                const recovery = yield* store.query({
                    serverId: config.serverId,
                    actor,
                    operation:
                        action.type === "unlock"
                            ? { type: "recovery-channel", channelId: action.channelId! }
                            : { type: "recovery-target", targetId: action.targetId! },
                })
                if (recovery.type !== "recovery")
                    return yield* Effect.fail(new ModerationHandlingError({ stage: "snapshot" }))
                action = {
                    ...action,
                    recoveryId: recovery.recovery.recoveryId,
                    linkedCaseNo: action.linkedCaseNo ?? recovery.recovery.caseNo,
                }
                nativeContext.recoveryGeneration = recovery.recovery.generation
            }
            operation = { type: "action", action, context: nativeContext }
        } else if (command.kind === "honeypot") {
            const current = yield* store.query({ serverId: config.serverId, actor, operation: { type: "settings" } })
            if (current.type !== "settings") return yield* Effect.fail(new ModerationHandlingError({ stage: "input" }))
            const ids = current.settings.honeypotChannelIds.filter((id) => id !== command.channelId)
            if (command.operation === "add") ids.push(command.channelId)
            operation = { type: "settings", patch: { honeypotChannelIds: ids } }
            // Only the named channel is checked, so a stored channel that was deleted since does not block the change
            checked = {
                type: "settings",
                patch: { honeypotChannelIds: command.operation === "add" ? [command.channelId] : [] },
            }
        } else if (command.kind === "manage") operation = command.operation
        else return yield* Effect.fail(new ModerationHandlingError({ stage: "input" }))
        yield* validateReferences(
            { kind: "manage", operation: checked ?? operation },
            authority,
            client,
            config.serverId,
        )
        if (operation.type === "action") refused = { authority, action: operation.action.type }
        const result = yield* store.manage({ serverId: config.serverId, actor, ...source, operation })
        if (result.duplicate) return
        if (result.type === "settings") yield* applyDefconPresence(client, config, result.settings.defcon)
        if (result.type === "case" && result.grant) {
            const outcome = yield* performActionGrant(
                store,
                config.serverId,
                message.author.id,
                client,
                result.grant,
                config,
                authority,
                authorityReadAt,
            )
            const c = result.case,
                linked = c.linkedCaseNo ? `. Linked to case #${c.linkedCaseNo}` : ""
            const done =
                outcome.outcome === "uncertain"
                    ? `is not confirmed yet. Run ${code(commandText("mod", `recover ${c.caseNo}`))} to check it`
                    : outcome.outcome
            const logged = outcome.logUncertain
                ? ". The staff log may not have arrived, and NeonFlux does not send it again"
                : ""
            const notified =
                outcome.notice === "sent"
                    ? outcome.outcome === "succeeded"
                        ? ". Member notified by DM"
                        : ". The member was already sent the notice"
                    : outcome.notice === "failed"
                      ? ". The member's DM could not be delivered"
                      : outcome.notice === "uncertain"
                        ? ". The member's DM may not have arrived, and NeonFlux does not send it again"
                        : ""
            const expired = outcome.expired
                ? ". Your permissions were checked too long before the action, so nothing was done. Run the command again"
                : ""
            const penalty = outcome.penaltyCaseNo ? `. Warning limit reached, see case #${outcome.penaltyCaseNo}` : ""
            const lock =
                c.action === "lock"
                    ? `. ${lockSummary(ownedPostingBits(result.grant))}. Other role or member grants may still permit them`
                    : ""
            // A ban, timeout or quarantine says how long it lasts, since a length that was not read would otherwise leave a permanent
            // ban unnoticed
            const lasting = result.grant.durationSeconds
            const name = c.action === "ban" && !lasting ? "Permanent ban" : actionNames[c.action]
            const length =
                lasting && ["ban", "timeout", "quarantine"].includes(c.action) ? ` for ${duration(lasting)}` : ""
            // A void is saved with its log case, which only the log delivery can fail
            if (operation.type === "case-void") {
                yield* answer(context, `Case #${c.linkedCaseNo} voided. Logged as case #${c.caseNo}${logged}`)
                return
            }
            yield* answer(
                context,
                `Case #${c.caseNo}: ${name}${c.targetId ? ` of ${format.userMention(c.targetId)}` : c.channelId ? ` in ${format.channelMention(c.channelId)}` : ""}${length} ${done}${linked}${expired}${notified}${logged}${penalty}${lock}`,
            )
        } else
            yield* respond(
                command.kind === "honeypot"
                    ? `${format.channelMention(command.channelId)} is ${command.operation === "add" ? "now" : "no longer"} a honeypot channel`
                    : manageConfirmation(result, operation),
            )
    }).pipe(
        Effect.catch((error) =>
            answer(
                context,
                error instanceof ModerationHandlingError
                    ? "NeonFlux couldn't check permissions, the current state or your DMs, so nothing was retried"
                    : error instanceof ModerationStoreError
                      ? (refused && moderationFix(error.code, refused.authority, refused.action, context.client)) ||
                        moderationErrorMessage(error)
                      : "The command could not be completed. Check its status before you try again",
            ),
        ),
    )
}
