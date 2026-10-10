import type * as C from "@neonflux/backend/contracts"
import { snowflakes, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { cleanupCritical, cleanupHelp, type CleanupCommand } from "./cleanup-command.ts"
import { fetchCleanupHistory } from "./cleanup-evidence.ts"
import { readCleanupContext } from "./cleanup-permissions.ts"
import { CleanupStoreError, type CleanupStore } from "./cleanup-store.ts"
import { CleanupHandlingError } from "./cleanup.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"

export const cleanupPolicyDetail = (p: C.CleanupPolicy) => `Channel ${p.channelId}: ${p.enabled ? "Enabled" : "Disabled"}, age ${p.ageMs / 3600000} hours, owner ${p.ownerId}\nExcluded authors ${p.excludedAuthorIds.length}/50, messages ${p.excludedMessageIds.length}/100${p.blockedReason ? `, blocked ${p.blockedReason}` : ""}`
const settingsDetail = (s: C.CleanupSettings) => `Cleanup module ${s.enabled ? "On" : "Off"}. Policies ${s.policies}/50, retained targets ${s.retainedTargets}`
export function handleCleanupCommand(store: CleanupStore, config: BotConfig, command: CleanupCommand | { error: string }, context: BotEventContext<"messageCreate">, worker?: { notify: () => Effect.Effect<void, unknown> }) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => Effect.gen(function* () { for (let index = 0; index < content.length; index += 1900) yield* context.reply({ content: content.slice(index, index + 1900), allowedMentions: noMentions }) })
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(withPrefix(cleanupHelp, prefix)); return }
        const channelId = "channelId" in command && command.channelId ? command.channelId : message.channelId
        const fresh = (destructive = !cleanupCritical(command)) => readCleanupContext(client, serverId, message.author.id, channelId, destructive)
        const query = (operation: C.CleanupQueryRequest["operation"]) => fresh(false).pipe(Effect.flatMap(context => store.query({ serverId, context, operation })))
        if (command.type === "show" || command.type === "list" || command.type === "status") {
            const list = `${prefix}cleanup status ${channelId}`, key = pageKey(serverId, message, "cleanup", "status", channelId)
            const before = command.type === "status" && command.next ? nextPosition<number>(key) : undefined
            if (command.type === "status" && command.next && before === undefined) { yield* reply(noNextPage(list)); return }
            const result = yield* query(command.type === "status" ? command.channelId ? { type: "status", channelId, ...(before ? { beforeTargetNo: before } : {}) } : { type: "settings" } : command.type === "show" ? { type: "show", channelId } : { type: "list" })
            if (result.type === "settings") yield* reply(settingsDetail(result.settings))
            else if (result.type === "policy") yield* reply(cleanupPolicyDetail(result.policy))
            else if (result.type === "policies") yield* reply(result.policies.map(cleanupPolicyDetail).join("\n") || "No configured cleanup channels")
            else if (result.type === "status") {
                rememberPosition(key, result.nextBeforeTargetNo)
                const counts = result.sweep?.counts
                yield* reply([settingsDetail(result.settings), cleanupPolicyDetail(result.policy), result.sweep ? `Sweep ${result.sweep.sweepNo}: ${result.sweep.state}${result.sweep.threadId ? `, thread ${result.sweep.threadId}` : ""}, page ${result.sweep.pageNo}, cursor ${result.sweep.before}, cutoff ${new Date(result.sweep.cutoffAt).toISOString()}` : "No retained sweep",
                    ...(counts ? [`Scanned ${counts.scanned}, skipped ${counts.skipped}, attempted ${counts.attempted}, invoked submissions ${counts.submitted}, acknowledged delete responses ${counts.acknowledged}, observed absent ${counts.observedAbsent}, unresolved ${counts.unresolved}, failed ${counts.failed}, cancelled ${counts.cancelled}`] : []),
                    ...result.targets.map(t => `Target ${t.targetNo}, message ${t.messageId}: ${t.state}${t.noDispatch ? ", proven no dispatch" : ""}${t.observation ? `, observed ${t.observation.status}` : ""}${t.lateOutcome ? `, late callback ${t.lateOutcome}` : ""}`),
                    ...(result.nextBeforeTargetNo ? [`Next: ${list} next`] : [])].join("\n"))
            }
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
            yield* reply(`Read-only sample of ${messages.length} messages: Eligible ${result.eligible}, skipped ${result.skipped} including ${result.unknown} unknown, cutoff ${new Date(result.cutoffAt).toISOString()}\nNo deletion was reserved. Pins, permissions, protection and history can change before a future pass`)
            return
        }
        if (command.type === "enable" && !command.confirmed) {
            yield* fresh(false)
            yield* reply(`Enabling may delete existing messages older than the configured age. Pins and permissions can race the final read\nConfirm: ${prefix}cleanup enable ${channelId} confirm`)
            return
        }
        const staff = yield* fresh()
        // Chat changes apply to the current revision, read right before the write, so the last of two changes wins. A channel without a policy has revision 0
        const current = yield* store.query({ serverId, context: staff, operation: command.type === "module" ? { type: "settings" } : { type: "list" } })
        const expectedRevision = current.type === "settings" ? current.settings.revision : current.type === "policies" ? current.policies.find(p => p.channelId === channelId)?.revision ?? 0 : yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
        const operation: C.CleanupManageOperation = command.type === "enable" || command.type === "disable" ? { type: "enable", channelId, expectedRevision, enabled: command.type === "enable", ...(command.type === "enable" ? { confirm: true as const } : {}) } : { ...command, expectedRevision }
        const result = yield* store.manage({ serverId, context: staff, messageId: message.id, createdAt: yield* sourceTimestamp(message), operation })
        if (result.duplicate) return
        if (worker) yield* worker.notify()
        if (result.type === "settings") yield* reply(settingsDetail(result.settings))
        else if (result.type === "policy") yield* reply(cleanupPolicyDetail(result.policy))
    }).pipe(Effect.catch(error => reply(error instanceof CleanupStoreError ? error.status === 409 ? "Cleanup settings changed while this command ran, work is unresolved or capacity is reached. Check status, then send the command again" : error.status === 403 ? "Cleanup denied by current staff, visibility or security policy" : "Cleanup persistence was not confirmed. Inspect status before another command"
        : "Current human identity, permissions or exact message evidence could not be verified. No deletion was authorized")))
}
