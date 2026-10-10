import type { CleanupQueryResult, CleanupPolicy, CleanupSettings, CleanupTargetState, CleanupTarget, CleanupCounts, CleanupSweep, CleanupQueryRequest, CleanupManageOperation } from "@neonflux/contracts/cleanup"
import { format, links, snowflakes, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { cleanupCritical, cleanupHelp, type CleanupCommand } from "./cleanup-command.ts"
import { fetchCleanupHistory } from "./cleanup-evidence.ts"
import { readCleanupContext } from "./cleanup-permissions.ts"
import { CleanupStoreError, type CleanupStore } from "./cleanup-store.ts"
import { CleanupHandlingError } from "./cleanup.ts"
import { sourceTimestamp } from "./responses.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { ago, at, code, duration, onOff, replyCard, replyText, type Card } from "./reply-style.ts"

type Status = Extract<CleanupQueryResult, { type: "status" }>
/** Cleanup channels per !cleanup list page */
const LIST_PAGE = 10
// Why the worker stopped on a channel. It tries the channel again within a minute
const blockedWords: Record<string, string> = { authority: "the permissions could not be confirmed", history: "the channel's messages could not be read",
    malformed: "the messages read could not be saved", quota: "the deletion limit is reached", target: "a message could not be deleted" }
/** A count with its limit, which shows only once at least 80% of it is used */
const used = (count: number, limit: number) => count >= limit * 0.8 ? `${count} of ${limit}` : String(count)
const stopped = (p: CleanupPolicy) => p.enabled && p.blockedReason ? `stopped because ${blockedWords[p.blockedReason] ?? "of an error"}. It tries again shortly` : undefined
const policyCard = (p: CleanupPolicy): Card => ({ title: "Cleanup channel", description: format.channelMention(p.channelId), fields: [["Status", stopped(p) ? `On, ${stopped(p)}` : onOff(p.enabled)],
    ["Deletes messages older than", duration(p.ageMs / 1000)], ["Owner", format.userMention(p.ownerId)], ...(p.enabled && p.nextCheckAt ? [["Next check", at(p.nextCheckAt)] as const] : []),
    ...(p.excludedAuthorIds.length ? [["Excluded authors", used(p.excludedAuthorIds.length, 50)] as const] : []), ...(p.excludedMessageIds.length ? [["Excluded messages", used(p.excludedMessageIds.length, 100)] as const] : [])] })
// The message record capacity is left out, because reaching it never pauses cleanup
const settingsCard = (s: CleanupSettings, prefix: string): Card => ({ title: "Cleanup", description: s.quotaPaused ? `${onOff(s.enabled)}, paused because the deletion limit is reached` : onOff(s.enabled),
    fields: [["Channels", used(s.policies, 50)]], note: `${code(`${prefix}cleanup list`)} lists the channels and ${code(`${prefix}cleanup status #channel`)} shows one` })
const targetStates: Record<CleanupTargetState, string> = { queued: "Waiting", reserved: "Deleting", deleted: "Deleted", failed: "Failed", uncertain: "Not confirmed", absent: "Already gone", skipped: "Kept", cancelled: "Cancelled" }
const checked = { present: "still there when checked", absent: "gone when checked", unknown: "could not be checked" } as const
/** One handled message as a jump link named by its place on the page, since messages have no names, with its thread when it was in one */
const targetLine = (serverId: string) => (t: CleanupTarget, index: number) => `[Message ${index + 1}](${links.message({ id: t.messageId, channelId: t.threadId ?? t.channelId }, { id: t.threadId ?? t.channelId, guildId: serverId })})`
    + `${t.threadId ? ` in ${format.channelMention(t.threadId)}` : ""}: ${t.noDispatch ? "Not attempted" : targetStates[t.state]}${t.observation ? `, ${checked[t.observation.status]}` : ""}`
const unsettled = (t: CleanupTarget) => t.state === "failed" || t.state === "uncertain"
// One hint covers every deletion that failed or is not confirmed
const unsettledHint = "NeonFlux never repeats a deletion that failed or is not confirmed, so check those messages yourself"
const runCounts = (c: CleanupCounts, none: string) => ([[c.acknowledged, "deleted"], [c.skipped, "kept"], [c.observedAbsent, "already gone"], [c.failed, "failed"], [c.unresolved, "not confirmed"], [c.cancelled, "cancelled"]] as const)
    .filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`).join(", ") || none
const lastRun = (s: CleanupSweep | null) => !s ? "No run yet" : s.state === "active" ? `Running, started ${ago(s.createdAt)}${s.threadId ? ` and now in ${format.channelMention(s.threadId)}` : ""}. So far: ${runCounts(s.counts, "nothing yet")}`
    : `Last run ${s.state === "complete" ? "finished" : "stopped"} ${ago(s.updatedAt)}: ${runCounts(s.counts, "nothing to delete")}`
/** !cleanup status #channel: Its state and last run in a few lines. The messages it handled page behind a command */
function statusCard({ settings, policy: p, sweep, targets }: Status, messages: string): Card {
    const where = format.channelMention(p.channelId), age = duration(p.ageMs / 1000), hint = sweep && (sweep.counts.failed || sweep.counts.unresolved) || targets.some(unsettled)
    return { title: "Cleanup channel", description: [stopped(p) ? `${where}: On, but ${stopped(p)}` : p.enabled ? `${where}: On, deletes messages older than ${age}` : `${where}: Off. When on, it deletes messages older than ${age}`,
        ...(!settings.enabled ? ["Cleanup is off for the whole server"] : settings.quotaPaused ? ["Cleanup is paused for the whole server because the deletion limit is reached"] : []), lastRun(sweep)].join("\n"),
        ...(hint ? { note: `${unsettledHint}. See them with ${messages}` } : targets.length ? { note: `Messages it handled: ${messages}` } : {}) }
}
// Commands that name a channel stay plain text, because a mention in inline code shows its raw form
const messagesCard = ({ policy, targets }: Status, serverId: string, next: string | undefined): Card => ({ title: "Cleanup messages",
    description: targets.length ? [`${format.channelMention(policy.channelId)}, newest first`, ...targets.map(targetLine(serverId))].join("\n") : `${format.channelMention(policy.channelId)}: No messages handled yet`,
    ...(next ? { fields: [["Next", next]] } : {}), ...(targets.some(unsettled) ? { note: unsettledHint } : {}) })
export function handleCleanupCommand(store: CleanupStore, config: BotConfig, command: CleanupCommand | { error: string }, context: BotEventContext<"messageCreate">, worker?: { notify: () => Effect.Effect<void, unknown> }) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, content), card = (value: Card) => replyCard(context, config.serverId, value)
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(withPrefix(cleanupHelp, prefix)); return }
        const channelId = "channelId" in command && command.channelId ? command.channelId : message.channelId
        const fresh = (destructive = !cleanupCritical(command)) => readCleanupContext(client, serverId, message.author.id, channelId, destructive)
        const query = (operation: CleanupQueryRequest["operation"]) => fresh(false).pipe(Effect.flatMap(context => store.query({ serverId, context, operation })))
        const where = format.channelMention(channelId), messageList = `${prefix}cleanup status ${where} messages`
        if (command.type === "list") {
            const start = `${prefix}cleanup list`, key = pageKey(serverId, message, "cleanup", "list"), next = command.next ? nextPosition<number>(key) : 1
            if (next === undefined) { yield* reply(noNextPage(start)); return }
            const result = yield* query({ type: "list" })
            if (result.type !== "policies") return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
            // Channels removed since the last page can shorten the list, so next shows its last page at most
            const pages = Math.max(1, Math.ceil(result.policies.length / LIST_PAGE)), page = Math.min(next, pages)
            rememberPosition(key, page < pages ? page + 1 : undefined)
            const shown = result.policies.slice((page - 1) * LIST_PAGE, page * LIST_PAGE)
            yield* card({ title: "Cleanup channels", description: shown.map(p => `${format.channelMention(p.channelId)}: ${onOff(p.enabled)}${stopped(p) ? ", stopped" : ""}, deletes messages older than ${duration(p.ageMs / 1000)}`).join("\n") || "No cleanup channels yet",
                ...(page < pages ? { fields: [["Next", code(`${start} next`)]] } : {}), ...(shown.length ? { note: `Details: ${code(`${prefix}cleanup status #channel`)}` } : {}) })
            return
        }
        if (command.type === "messages") {
            const key = pageKey(serverId, message, "cleanup", "messages", channelId), before = command.next ? nextPosition<number>(key) : undefined
            if (command.next && before === undefined) { yield* reply(noNextPage(messageList)); return }
            const result = yield* query({ type: "status", channelId, ...(before ? { beforeTargetNo: before } : {}) })
            if (result.type !== "status") return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
            rememberPosition(key, result.nextBeforeTargetNo)
            yield* card(messagesCard(result, serverId, result.nextBeforeTargetNo ? `${messageList} next` : undefined))
            return
        }
        if (command.type === "show" || command.type === "status") {
            const result = yield* query(command.type === "show" ? { type: "show", channelId } : command.channelId ? { type: "status", channelId } : { type: "settings" })
            if (result.type === "settings") yield* card(settingsCard(result.settings, prefix))
            else if (result.type === "policy") yield* card(policyCard(result.policy))
            else if (result.type === "status") yield* card(statusCard(result, messageList))
            return
        }
        if (command.type === "preview") {
            const policy = yield* query({ type: "show", channelId })
            if (policy.type !== "policy") return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
            const authority = yield* fresh(false)
            if (!authority.botMember.canView || !authority.botMember.canReadHistory) return yield* Effect.fail(new CleanupHandlingError({ stage: "eligibility" }))
            const before = snowflakes.boundary(new Date((yield* Clock.currentTimeMillis) - policy.policy.ageMs))
            const messages = yield* fetchCleanupHistory(client, serverId, channelId, before)
            const result = yield* query({ type: "preview", channelId, messages })
            if (result.type !== "preview") return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
            yield* card({ title: "Cleanup preview", description: `${format.channelMention(channelId)}. Nothing was deleted. Pins, permissions and history can change before cleanup runs`,
                fields: [["Messages checked", String(messages.length)], ["Would delete", String(result.eligible)], ["Would keep", `${result.skipped}${result.unknown ? `, ${result.unknown} of them because their details could not be read` : ""}`],
                    ["Deletes messages sent before", at(result.cutoffAt)]] })
            return
        }
        if (command.type === "enable" && !command.confirmed) {
            yield* fresh(false)
            yield* reply(`Turning cleanup on may delete existing messages older than the set age. Pins and permissions can change right before it reads them\nConfirm: ${prefix}cleanup enable ${where} confirm`)
            return
        }
        const staff = yield* fresh()
        // Chat changes apply to the current revision, read right before the write, so the last of two changes wins. A channel without a policy has revision 0
        const current = yield* store.query({ serverId, context: staff, operation: command.type === "module" ? { type: "settings" } : { type: "list" } })
        const expectedRevision = current.type === "settings" ? current.settings.revision : current.type === "policies" ? current.policies.find(p => p.channelId === channelId)?.revision ?? 0 : yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
        const operation: CleanupManageOperation = command.type === "enable" || command.type === "disable" ? { type: "enable", channelId, expectedRevision, enabled: command.type === "enable", ...(command.type === "enable" ? { confirm: true as const } : {}) } : { ...command, expectedRevision }
        const result = yield* store.manage({ serverId, context: staff, messageId: message.id, createdAt: yield* sourceTimestamp(message), operation })
        if (result.duplicate) return
        if (worker) yield* worker.notify()
        if (result.type === "settings") yield* reply(`Cleanup is now ${onOff(result.settings.enabled).toLowerCase()}`)
        else if (result.type === "policy") yield* reply(command.type === "configure" ? `Cleanup in ${where} now deletes messages older than ${duration(result.policy.ageMs / 1000)}${result.policy.enabled ? "" : `. It is off until ${prefix}cleanup enable ${where}`}`
            // The excluded message may sit in a thread of the channel, so it is not linked
            : command.type === "exclude" ? command.kind === "author" ? `Messages by ${format.userMention(command.id)} ${command.add ? "now stay" : "no longer stay"} in ${where}` : `That message ${command.add ? "now stays" : "no longer stays"} in ${where}`
                : `Cleanup is now ${onOff(result.policy.enabled).toLowerCase()} in ${where}`)
    }).pipe(Effect.catch(error => reply(error instanceof CleanupStoreError ? error.status === 409 ? `Cleanup settings changed while this command ran, a deletion is not confirmed yet or a limit is reached. Check ${code(`${prefix}cleanup status`)}, then send the command again`
        : error.status === 403 ? "Your staff role, channel access or a security setting does not allow this cleanup command" : `The cleanup change could not be confirmed. Check ${code(`${prefix}cleanup status`)} before another command`
        : "NeonFlux couldn't check your permissions or the channel's messages, so nothing was deleted")))
}
