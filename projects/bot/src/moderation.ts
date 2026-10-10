import type * as C from "@neonflux/backend/contracts"
import { isThreadChannel, Permissions, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit, Semaphore } from "effect"
import { serverOption, serverReply } from "./server-scope.ts"
import { actionPermission, executeAction, observeAction, overwriteSnapshot } from "./action-executor.ts"
import type { BotConfig, BotRootConfig } from "./config.ts"
import { appealDetails, manageConfirmation, queryDetails, splitReport } from "./moderation-format.ts"
import { safetyHelp, type SafetyCommand, type SafetyName } from "./moderation-command.ts"
import { ModerationStoreError, moderationErrorMessage, type ModerationStore } from "./moderation-store.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { channelPermissionInput, ownedPostingBits, readSafetyAuthority, restorablePostingBits, verifyPrivateAuthor, type SafetyAuthority } from "./safety-permissions.ts"
import { fixSentence, highestRole, labelList, permissionNames } from "./permission-fix.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"

export class ModerationHandlingError extends Data.TaggedError("ModerationHandlingError")<{ readonly stage: "permissions" | "snapshot" | "outcome" | "private-delivery" | "input" }> {}
export function moderationActor(authority: SafetyAuthority): C.ModerationActor {
    return { originServerId: authority.guild.id, userId: authority.actorId, roleIds: authority.roleIds, isOwner: authority.isOwner, isAdministrator: authority.isAdmin, nativePermissionAuthorized: authority.nativePermissionAuthorized }
}
export function actionContext(authority: SafetyAuthority, action?: C.ModerationActionType): C.ModerationActionContext {
    return {
        originServerId: authority.guild.id, botId: authority.botId, botActionAuthorized: authority.botPermissionAuthorized,
        actorCanManageTarget: authority.actorCanManageTarget, botCanManageTarget: authority.botCanManageTarget, targetProtected: authority.targetProtected,
        ...(authority.target?.communicationDisabledUntil !== undefined ? { currentTimeoutUntil: authority.target.communicationDisabledUntil } : {}),
        ...(authority.channel && (action === "lock" || action === "unlock") ? { currentOverwrite: overwriteSnapshot(authority.channel, authority.guild.id) } : {}),
        ...(action === "lock" ? { botPostingPermissions: restorablePostingBits(authority.botServerPermissions) } : {}),
        ...(authority.channel && "rateLimitPerUser" in authority.channel && typeof authority.channel.rateLimitPerUser === "number" ? { currentSlowmodeSeconds: authority.channel.rateLimitPerUser } : {}),
    }
}

const presenceOwners = new WeakMap<Client, { levels: Map<string, 1 | 2 | 3 | undefined>, applied?: string, lock: Semaphore.Semaphore }>()
// Called on every gated message, so the provider is only contacted when the shown DEFCON state changes.
// Multi mode shows only the configured status, so one server's DEFCON or backend outage never changes the shared presence
export function applyDefconPresence(client: Client, config: Pick<BotRootConfig, "serverId" | "scope" | "customStatus">, level: 1 | 2 | 3 | undefined) {
    return Effect.suspend(() => {
        const multi = config.scope?.mode === "multi"
        let owner = presenceOwners.get(client)
        if (!owner) {
            owner = { levels: new Map(multi || config.serverId === undefined ? [] : [[config.serverId, undefined]]), lock: Semaphore.makeUnsafe(1) }
            presenceOwners.set(client, owner)
        }
        const current = owner
        return current.lock.withPermit(Effect.suspend(() => {
            if (!multi && config.serverId !== undefined) current.levels.set(config.serverId, level)
            const unknown = [...current.levels.values()].some(value => value === undefined)
            const restrictive = Math.min(...[...current.levels.values()].map(value => value ?? 1))
            const custom = config.customStatus ? { text: config.customStatus } : null
            const presence = multi ? { status: "online" as const, customStatus: custom } : { status: restrictive === 3 ? "online" as const : "dnd" as const, customStatus: unknown ? { text: "Security backend unavailable" }
                : restrictive === 3 ? custom : { text: `DEFCON ${restrictive}` } }
            const key = JSON.stringify(presence)
            if (current.applied === key) return Effect.void
            return client.presence.set(presence).pipe(Effect.tap(() => Effect.sync(() => { current.applied = key })))
        }))
    })
}

// Interrupted actions and deliveries from the previous process become uncertain once at startup
export function initializeModeration(store: ModerationStore, config: BotConfig, client: Client) {
    return store.observe({ serverId: config.serverId }).pipe(
        Effect.flatMap((result) => applyDefconPresence(client, config, result.settings.defcon)),
        Effect.catch(() => applyDefconPresence(client, config, undefined)),
    )
}

function sendOutcome<A extends { id: string }>(operation: Effect.Effect<A, unknown>) {
    return Effect.gen(function* () {
        const result = yield* Effect.exit(operation)
        if (Exit.isFailure(result) && Cause.hasInterrupts(result.cause)) return yield* Effect.failCause(result.cause)
        if (Exit.isSuccess(result)) return { outcome: "sent" as const, sentMessageId: result.value.id }
        const uncertain = result.cause.reasons.some((reason) => reason._tag === "Die" || (reason._tag === "Fail" && reason.error !== null && typeof reason.error === "object" && "outcome" in reason.error && reason.error.outcome === "unknown"))
        return { outcome: uncertain ? "uncertain" as const : "failed" as const }
    })
}

export function performActionGrant(store: ModerationStore, serverId: string, actorId: string, client: Client, grant: C.ModerationActionGrant,
    config?: BotConfig, authority?: SafetyAuthority, authorityReadAt?: number) {
    return Effect.gen(function* () {
        const confirm = store.dispatch({ serverId, actionId: grant.actionId, caseNo: grant.caseNo, dispatch: true })
        // A command's authority is trusted for 15 seconds, so a moderator revoked during a slow reservation never dispatches
        const expired = authorityReadAt !== undefined && (yield* Clock.currentTimeMillis) - authorityReadAt > 15000
        // A grant that stopped being pending is never dispatched and its stored outcome is left alone
        const executed = expired ? { outcome: "failed" as const } : yield* executeAction(client, serverId, actorId, grant, confirm, authority).pipe(
            Effect.catch((error) => error instanceof ModerationStoreError ? Effect.fail(error) : Effect.succeed({ outcome: "failed" as const })),
        )
        const result = yield* store.outcome({ serverId, actionId: grant.actionId, caseNo: grant.caseNo, ...executed })
        if (!result.recorded) return yield* Effect.fail(new ModerationHandlingError({ stage: "outcome" }))
        const multi = config?.scope?.mode === "multi"
        // Log content excludes narratives because a configured channel is not proof of confidentiality
        const logDelivery = yield* Effect.exit(Effect.gen(function* () {
            if (result.log) {
                const log = result.log
                const sent = yield* sendOutcome(client.messages.send(log.channelId, {
                    content: `Case ${log.caseNo}: ${log.action}, ${log.outcome}, actor ${actorId}${log.targetId ? `, user ${log.targetId}` : ""}. `
                        + `Use ${replyPrefix(serverId, serverId)}case${multi ? ` --server ${serverId}` : ""} show ${log.caseNo} for private details`,
                    allowedMentions: noMentions,
                }, { timeoutMs: 5000 }))
                const acknowledged = yield* store.logOutcome({ serverId, logId: log.logId, caseNo: log.caseNo, ...sent })
                if (!acknowledged.recorded) return yield* Effect.fail(new ModerationHandlingError({ stage: "outcome" }))
            }
        }))
        if (Exit.isFailure(logDelivery) && Cause.hasInterrupts(logDelivery.cause)) return yield* Effect.failCause(logDelivery.cause)
        const noticeDelivery = yield* Effect.exit(Effect.gen(function* () {
            if (result.notice) {
                const notice = result.notice
                if (grant.action !== "warn" || notice.targetId !== grant.targetId || notice.reason !== grant.reason) return yield* Effect.fail(new ModerationHandlingError({ stage: "outcome" }))
                const server = multi ? ` --server ${serverId}` : ""
                const sent = yield* sendOutcome(client.directMessages.send(notice.targetId, {
                    content: `${multi ? `[Server ${serverId}] ` : ""}Warning, case ${notice.caseNo}: ${notice.reason}\n`
                        + `To appeal, DM !appeal${server} submit ${notice.caseNo} "your reason". DM !appeal${server} cases to see your eligible cases`,
                    allowedMentions: noMentions,
                }, { timeoutMs: 5000 }))
                const acknowledged = yield* store.noticeOutcome({ serverId, noticeId: notice.noticeId, caseNo: notice.caseNo, ...sent })
                if (!acknowledged.recorded) return yield* Effect.fail(new ModerationHandlingError({ stage: "outcome" }))
            }
        }))
        if (Exit.isFailure(noticeDelivery) && Cause.hasInterrupts(noticeDelivery.cause)) return yield* Effect.failCause(noticeDelivery.cause)
        return { outcome: executed.outcome, expired, ancillaryUncertain: Exit.isFailure(logDelivery) || Exit.isFailure(noticeDelivery) }
    })
}

const threadPermissionNames = [[Permissions.SendMessagesInThreads, "Send Messages in Threads"], [Permissions.CreatePublicThreads, "Create Public Threads"],
    [Permissions.CreatePrivateThreads, "Create Private Threads"]] as const
/** What a lock denied. A thread permission NeonFlux lacks stays open, because unlock could not restore it */
function lockSummary(owned: bigint) {
    const missing = threadPermissionNames.filter(([bit]) => (owned & bit) === 0n).map(([, name]) => name)
    return missing.length === 0 ? "The everyone overwrite now denies sending, sending in threads and starting threads"
        : `The everyone overwrite now denies sending${owned === Permissions.SendMessages ? "" : " and the thread permissions NeonFlux holds"}. NeonFlux lacks ${missing.join(", ")} in this server, so those stay open. Grant them to NeonFlux to lock threads too`
}

function privateChannel(client: Client, userId: string, channelId?: string) {
    return Effect.gen(function* () {
        const id = channelId ?? (yield* client.directMessages.open(userId, { timeoutMs: 5000 })).id
        yield* verifyPrivateAuthor(client, id, userId)
        return id
    })
}
function sendReport(client: Client, channelId: string, content: string, config: BotConfig) {
    if (config.scope?.mode === "multi") content = serverReply(content, config.serverId)
    return Effect.forEach(splitReport(content), (page) => client.messages.send(channelId, { content: page, allowedMentions: noMentions }, { timeoutMs: 5000 }), { concurrency: 1, discard: true })
}
function validateReferences(command: Extract<SafetyCommand, { kind: "manage" }>, authority: SafetyAuthority, client: Client, serverId: string) {
    return Effect.gen(function* () {
        const op = command.operation
        const channelIds: string[] = []
        const roleIds: string[] = []
        if (op.type === "settings") {
            channelIds.push(...(op.patch.honeypotChannelIds ?? []), ...(op.patch.logChannelId ? [op.patch.logChannelId] : []))
            roleIds.push(...Object.values(op.patch.staffRoleIds ?? {}).flat())
        }
        if (op.type === "rule-create" || op.type === "rule-update") {
            const rule = op.type === "rule-create" ? op.rule : op.patch
            channelIds.push(...(rule.channelIds ?? []), ...(rule.exemptChannelIds ?? []))
            roleIds.push(...(rule.exemptRoleIds ?? []))
        }
        if (roleIds.some((id) => !authority.roles.some((role) => role.id === id && role.guildId === serverId))) return yield* Effect.fail(new ModerationHandlingError({ stage: "input" }))
        for (const id of new Set(channelIds)) {
            const channel = yield* client.channels.fetch(id)
            if (channel.id !== id || channel.guildId !== serverId) return yield* Effect.fail(new ModerationHandlingError({ stage: "input" }))
        }
    }).pipe(Effect.timeout("5 seconds"), Effect.mapError(() => new ModerationHandlingError({ stage: "input" })))
}

/** What to change when the backend refused an action for the bot's or the actor's permissions or rank, from the authority read for it */
export function moderationFix(code: string | undefined, authority: SafetyAuthority, action: C.ModerationActionType, client: Client) {
    const required = actionPermission(action) ?? 0n
    switch (code) {
        case "BOT_PERMISSION": {
            const botBits = client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, ...channelPermissionInput(authority) })
            return fixSentence({ permissions: permissionNames(required & ~botBits || required), channelId: authority.channel?.id })
        }
        case "BOT_BELOW_TARGET": {
            const top = authority.target && highestRole(authority.target, authority.roles)
            return top ? fixSentence({ roles: [top.id] }) : "Give NeonFlux a role of its own so it can act on members"
        }
        case "ACTOR_BELOW_TARGET": {
            const top = authority.target && highestRole(authority.target, authority.roles)
            return `Your highest role must rank above ${top ? `<@&${top.id}>` : "this member's highest role"} to act on this member`
        }
        case "ACTOR_PERMISSION": return `You need ${labelList(permissionNames(required))} for this action`
        case "TARGET_PROTECTED": return "NeonFlux never acts on itself, the server owner, Administrators or the member who sent the command"
        default: return undefined
    }
}

export function handleSafetyCommand(store: ModerationStore, config: BotConfig, name: SafetyName, command: SafetyCommand, context: BotEventContext<"messageCreate">, privateInvocation = false) {
    // The authority and action of a backend refusal, so its reply can name the fix
    let refused: { authority: SafetyAuthority, action: C.ModerationActionType } | undefined
    return Effect.gen(function* () {
        const { message, client, reply } = context
        const respond = (content: string) => reply({ content, allowedMentions: noMentions })
        if (command.kind === "help") { yield* respond(withPrefix(safetyHelp(name), replyPrefix(config.serverId, context.message.guildId))); return }
        const source = { messageId: message.id, createdAt: yield* sourceTimestamp(message) }
        if (command.kind === "member-appeal") {
            if (!privateInvocation) { yield* respond(`Send !appeal${config.scope?.mode === "multi" ? ` --server ${config.serverId}` : ""} commands in a private one-to-one DM with me`); return }
            yield* verifyPrivateAuthor(client, message.channelId, message.author.id)
            const result = yield* store.memberAppeal({ serverId: config.serverId, requesterId: message.author.id, originServerId: config.serverId, privateChannelVerified: true, ...source, operation: command.operation })
            if (result.duplicate) return
            const report = result.type === "appeal" ? appealDetails(result.appeal) : result.type === "appeals"
                ? `Appeals, page ${result.page}/${result.totalPages}\n${result.appeals.map(appealDetails).join("\n\n") || "None"}`
                : `Your eligible cases\n${result.cases.map((value) => `Case ${value.caseNo}: ${value.action}, ${value.outcome}\nReason: ${value.reason}`).join("\n\n") || "None"}${result.nextBeforeCaseNo ? `\nNext: !appeal${serverOption(config)} cases ${result.nextBeforeCaseNo}` : ""}`
            yield* sendReport(client, message.channelId, report, config)
            return
        }
        let action = command.kind === "action" ? command.action : undefined
        // Authority is read once per command and reused for the provider action
        let purgeAuthority: SafetyAuthority | undefined
        let purgeReadAt: number | undefined
        if (command.kind === "purge") {
            purgeAuthority = yield* readSafetyAuthority(client, config.serverId, message.author.id, { permission: Permissions.ManageMessages, channelId: message.channelId })
            purgeReadAt = yield* Clock.currentTimeMillis
            if (!purgeAuthority.nativePermissionAuthorized) return yield* Effect.fail(new ModerationHandlingError({ stage: "permissions" }))
            if (!purgeAuthority.botPermissionAuthorized) { yield* respond(moderationFix("BOT_PERMISSION", purgeAuthority, "purge", client)!); return }
            const selection = yield* client.messages.previewCleanup(message.channelId, {
                maxScanned: 500, maxSelected: command.count, ...(command.userId ? { authorId: command.userId } : {}), filter: (item) => item.id !== message.id,
            }, { timeoutMs: 5000 })
            if (!selection.selectedMessages.length) { yield* respond("No matching messages were selected"); return }
            action = { type: "purge", channelId: message.channelId, messageIds: selection.selectedMessages.map((item) => item.id), reason: command.reason }
        }
        const authority = purgeAuthority ?? (yield* readSafetyAuthority(client, config.serverId, message.author.id, {
            ...(action && actionPermission(action.type) !== undefined ? { permission: actionPermission(action.type)! } : {}),
            ...(action?.targetId ? { targetId: action.targetId, allowAbsentTarget: action.type === "ban" || action.type === "unban" } : {}),
            ...(action?.channelId ? { channelId: action.channelId } : {}),
        }))
        const authorityReadAt = purgeReadAt ?? (yield* Clock.currentTimeMillis)
        const actor = moderationActor(authority)
        if (command.kind === "query") {
            const dm = command.private ? yield* privateChannel(client, message.author.id, privateInvocation ? message.channelId : undefined) : undefined
            const result = yield* store.query({ serverId: config.serverId, actor, operation: command.operation, ...(dm ? { originServerId: config.serverId, privateChannelVerified: true } : {}) })
            if (dm) {
                yield* sendReport(client, dm, queryDetails(result, command.operation), config)
                if (!privateInvocation) yield* respond("Private details sent by DM")
            } else yield* sendReport(client, message.channelId, queryDetails(result), config)
            return
        }
        if (command.kind === "staff-appeal") {
            const dm = yield* privateChannel(client, message.author.id, privateInvocation ? message.channelId : undefined)
            const result = yield* store.staffAppeal({ serverId: config.serverId, actor, originServerId: config.serverId, privateChannelVerified: true, ...source, operation: command.operation })
            if (result.duplicate) return
            const report = result.type === "appeal" ? appealDetails(result.appeal) : `Appeals, page ${result.page}/${result.totalPages}\n${result.appeals.map(appealDetails).join("\n\n") || "None"}`
            yield* sendReport(client, dm, report, config)
            if (!privateInvocation) yield* respond(result.type === "appeal" ? `Appeal ${result.appeal.appealNo}: ${result.appeal.status}. Private details sent by DM` : "Private appeal list sent by DM")
            return
        }
        if (command.kind === "recover") {
            const dm = yield* privateChannel(client, message.author.id, privateInvocation ? message.channelId : undefined)
            const record = yield* store.query({ serverId: config.serverId, actor, originServerId: config.serverId, privateChannelVerified: true, operation: { type: name === "security" ? "recovery-case" : "case-show", caseNo: command.caseNo } })
            if (record.type !== "case") return yield* Effect.fail(new ModerationHandlingError({ stage: "input" }))
            const recoveryAuthority = yield* readSafetyAuthority(client, config.serverId, message.author.id, {
                ...(actionPermission(record.case.action) !== undefined ? { permission: actionPermission(record.case.action)! } : {}),
                ...(record.case.channelId ? { channelId: record.case.channelId } : {}),
            })
            if (!recoveryAuthority.nativePermissionAuthorized) return yield* Effect.fail(new ModerationHandlingError({ stage: "permissions" }))
            const observation = yield* observeAction(client, config.serverId, record.case)
            const result = yield* store.reconcile({ serverId: config.serverId, actor: moderationActor(recoveryAuthority), originServerId: config.serverId, privateChannelVerified: true, ...source, actionId: record.case.actionId, observation })
            if (!result.recorded) return yield* Effect.fail(new ModerationHandlingError({ stage: "outcome" }))
            yield* sendReport(client, dm, queryDetails({ type: "case", case: result.case }), config)
            if (!privateInvocation) yield* respond(`Case ${result.case.caseNo} observed. No sanction or delivery was replayed. Private details sent by DM`)
            return
        }
        let operation: C.ModerationManageOperation
        if (action && (action.type === "lock" || action.type === "unlock") && isThreadChannel(authority.channel)) {
            // A thread has no overwrites to change. Locking its parent covers posting in its threads
            yield* respond(`Threads follow their parent channel's permissions. ${action.type === "lock" ? "Lock" : "Unlock"} <#${authority.channel.parentId}> instead`)
            return
        }
        if (action) {
            const nativeContext = actionContext(authority, action.type)
            if (action.type === "unlock" || action.type === "release") {
                const recovery = yield* store.query({ serverId: config.serverId, actor, operation: action.type === "unlock" ? { type: "recovery-channel", channelId: action.channelId! } : { type: "recovery-target", targetId: action.targetId! } })
                if (recovery.type !== "recovery") return yield* Effect.fail(new ModerationHandlingError({ stage: "snapshot" }))
                action = { ...action, recoveryId: recovery.recovery.recoveryId, linkedCaseNo: action.linkedCaseNo ?? recovery.recovery.caseNo }
                nativeContext.recoveryGeneration = recovery.recovery.generation
            }
            operation = { type: "action", action, context: nativeContext }
        } else if (command.kind === "honeypot") {
            const current = yield* store.query({ serverId: config.serverId, actor, operation: { type: "settings" } })
            if (current.type !== "settings") return yield* Effect.fail(new ModerationHandlingError({ stage: "input" }))
            const ids = current.settings.honeypotChannelIds.filter((id) => id !== command.channelId)
            if (command.operation === "add") ids.push(command.channelId)
            operation = { type: "settings", patch: { honeypotChannelIds: ids } }
        } else if (command.kind === "manage") operation = command.operation
        else return yield* Effect.fail(new ModerationHandlingError({ stage: "input" }))
        yield* validateReferences({ kind: "manage", operation }, authority, client, config.serverId)
        if (operation.type === "action") refused = { authority, action: operation.action.type }
        const result = yield* store.manage({ serverId: config.serverId, actor, ...source, operation })
        if (result.duplicate) return
        if (result.type === "settings") yield* applyDefconPresence(client, config, result.settings.defcon)
        if (result.type === "case" && result.grant) {
            const outcome = yield* performActionGrant(store, config.serverId, message.author.id, client, result.grant, config, authority, authorityReadAt)
            const linked = result.case.linkedCaseNo ? `, linked to case ${result.case.linkedCaseNo}` : ""
            const uncertain = outcome.ancillaryUncertain ? ". The action outcome is recorded, but a log or private notice acknowledgement is uncertain. No delivery was retried" : ""
            const expired = outcome.expired ? ". The permission check expired before dispatch, so nothing was sent. Run the command again" : ""
            const lock = result.case.action === "lock" ? `. ${lockSummary(ownedPostingBits(result.grant))}. Other role or member grants may still permit them` : ""
            yield* respond(`Case ${result.case.caseNo}: ${result.case.action}, ${outcome.outcome}${linked}${expired}${uncertain}${lock}`)
        } else {
            const confirmation = manageConfirmation(result)
            if (confirmation) yield* sendReport(client, message.channelId, confirmation, config)
        }
    }).pipe(Effect.catch((error) => context.reply({ content: error instanceof ModerationHandlingError ? "I couldn't verify permissions, state, or private delivery. No uncertain operation was retried"
        : error instanceof ModerationStoreError ? (refused && moderationFix(error.code, refused.authority, refused.action, context.client)) || moderationErrorMessage(error)
            : "I couldn't complete the verified operation. Check its status before attempting it again", allowedMentions: noMentions })))
}
