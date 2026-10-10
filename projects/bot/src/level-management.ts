import type * as C from "@neonflux/backend/contracts"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { levelHelp, type LevelCommand, parseRankCommand, parseLeaderboardCommand } from "./level-command.ts"
import { rankCard } from "./level-render.ts"
import { LevelingHandlingError } from "./leveling.ts"
import { levelingMember } from "./member-evidence.ts"
import { LevelingStoreError, levelingErrorMessage, type LevelingStore } from "./level-store.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { readRoleAuthority } from "./role-permissions.ts"
import { roleSnapshots } from "./roles.ts"
import { moderationActor } from "./moderation.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import type { startLevelRoleWorker } from "./level-worker.ts"

export type LevelInvocation = { name: "level", command: LevelCommand | { error: string } }
    | { name: "rank", command: ReturnType<typeof parseRankCommand> }
    | { name: "leaderboard", command: ReturnType<typeof parseLeaderboardCommand> }
const formatSettings = (s: C.LevelingSettings) => [
    `Message XP: ${s.enabled ? "Enabled" : "Disabled"}, ${s.xpPerMessage} XP per ${s.cooldownSeconds} seconds`,
    `Excluded channels: ${s.excludedChannelIds.join(", ") || "None"}`,
    `Excluded roles: ${s.excludedRoleIds.join(", ") || "None"}`,
    `Cumulative rewards: ${s.mappings.map(m => `Level ${m.level}: Role ${m.roleId}`).join(", ") || "None"}`,
].join("\n")

export function handleLevelCommand(store: LevelingStore, config: BotConfig, invocation: LevelInvocation,
    context: BotEventContext<"messageCreate">, worker?: Effect.Success<ReturnType<typeof startLevelRoleWorker>>) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => Effect.gen(function* () {
        for (let offset = 0; offset < content.length; offset += 1900) yield* context.reply({ content: content.slice(offset, offset + 1900), allowedMentions: noMentions })
    })
    const work = Effect.gen(function* () {
        const command = invocation.command
        if ("error" in command) { yield* reply(command.error); return }
        if (invocation.name === "level" && !("error" in invocation.command) && invocation.command.type === "help") { yield* reply(withPrefix(levelHelp(), prefix)); return }
        const authority = yield* readSafetyAuthority(context.client, config.serverId, context.message.author.id)
        const actor = moderationActor(authority), member = levelingMember(authority.actor, config.serverId, actor.userId)
        if (!member || member.isBot) return yield* Effect.fail(new LevelingHandlingError({ stage: "membership" }))
        if (invocation.name === "level" && !authority.isOwner && !authority.isAdmin) { yield* reply("Only the server owner or an administrator can manage leveling"); return }
        const query = (operation: C.LevelingQueryRequest["operation"]) => Clock.currentTimeMillis.pipe(Effect.flatMap(observedAt => store.query({ serverId: config.serverId, actor, member, observedAt, operation })))
        if (invocation.name === "rank" && !("error" in invocation.command)) {
            const result = yield* query({ type: "rank", ...invocation.command })
            if (result.type !== "rank") return yield* Effect.fail(new LevelingHandlingError({ stage: "response" }))
            const { rank } = result
            yield* context.reply(rankCard(result.profile.userId, result.profile.xp, rank.type === "exact" ? rank.position : rank.type === "range" ? { from: rank.from, to: rank.to } : rank.type))
            return
        }
        if (invocation.name === "leaderboard" && !("error" in invocation.command)) {
            const key = pageKey(config.serverId, context.message, "leaderboard"), cursor = invocation.command.next ? nextPosition<C.LevelingLeaderboardCursor>(key) : undefined
            if (invocation.command.next && !cursor) { yield* reply(noNextPage(`${prefix}leaderboard`)); return }
            // A server reset refuses the remembered position, so a failed page forgets it and the list starts again
            const result = yield* query({ type: "leaderboard", ...(cursor ? { cursor } : {}) }).pipe(Effect.tapError(() => Effect.sync(() => rememberPosition(key, undefined))))
            if (result.type !== "leaderboard") return yield* Effect.fail(new LevelingHandlingError({ stage: "response" }))
            rememberPosition(key, result.nextCursor)
            yield* reply(["Message XP leaderboard", ...result.profiles.map(p => `Member ${p.userId}: Level ${p.level}, ${p.xp.toLocaleString("en-US")} XP`),
                ...(result.profiles.length ? [] : ["No ranked scores"]), ...(result.nextCursor ? [`Next: ${prefix}leaderboard next`] : [])].join("\n"))
            return
        }
        if (invocation.name !== "level" || "error" in invocation.command) return
        const c = invocation.command
        if (c.type === "config" || c.type === "status" || c.type === "audit") {
            const key = pageKey(config.serverId, context.message, "level audit"), before = c.type === "audit" && c.next ? nextPosition<number>(key) : undefined
            if (c.type === "audit" && c.next && before === undefined) { yield* reply(noNextPage(`${prefix}level audit`)); return }
            const result = yield* query(c.type === "config" ? { type: "settings" } : c.type === "status" ? { type: "status" }
                : { type: "audits", ...(before !== undefined ? { beforeAuditNo: before } : {}) })
            if (result.type === "settings") yield* reply(formatSettings(result.settings))
            else if (result.type === "status") yield* reply(`Level rewards: ${result.dirty} dirty accounts, sweep ${result.sweepPending ? "Pending" : "Complete"}, ${result.profiles} stored profiles`)
            else if (result.type === "audits") {
                rememberPosition(key, result.nextBeforeAuditNo)
                const lines = result.audits.map(a => {
                    const member = a.userId ? `member ${a.userId}, ${a.beforeXp} → ${a.afterXp} XP, ` : ""
                    return `Audit ${a.auditNo}: ${a.type}, actor ${a.actorId}, ${member}${new Date(a.createdAt).toISOString()}, reason ${a.reason}`
                })
                yield* reply([...lines, ...(result.audits.length ? [] : ["No correction audit records"]),
                    ...(result.nextBeforeAuditNo ? [`Next: ${prefix}level audit next`] : [])].join("\n"))
            }
            else return yield* Effect.fail(new LevelingHandlingError({ stage: "response" }))
            return
        }
        // No backend change occurs until the user supplies the scope-specific confirmation.
        if ((c.type === "reset-member" || c.type === "reset-server" || c.type === "clear") && !c.confirmed) {
            // The reason is free text, so only a backslash, a double quote and an apostrophe outside a word need escaping
            const text = (value: string) => value.replace(/\\|"|(?<!\p{L})'|'(?!\p{L})/gu, "\\$&")
            const command = c.type === "clear" ? `${prefix}level clear confirm` : c.type === "reset-server" ? `${prefix}level reset server ${text(c.reason)} confirm`
                : `${prefix}level reset member ${c.userId} ${text(c.reason)} confirm`
            yield* reply(`${c.type === "clear" ? "Clearing mappings queues withdrawal of confirmed owned level rewards" : "Resetting scores preserves cooldown, duplicate and replay defenses and queues owned reward withdrawal"}\nConfirm this exact scope with: ${command}`)
            return
        }
        let operation: C.LevelingManageOperation | undefined, currentActor = actor
        if (c.type === "module" || c.type === "rate" || c.type === "exclude") {
            // The current revision is read here so members never type it. It still fences dashboard edits.
            const settings = yield* query({ type: "settings" })
            if (settings.type !== "settings") return yield* Effect.fail(new LevelingHandlingError({ stage: "response" }))
            const patch: Extract<C.LevelingManageOperation, { type: "settings" }>["patch"] = c.type === "module" ? { enabled: c.enabled }
                : c.type === "rate" ? { xpPerMessage: c.xp, cooldownSeconds: c.cooldown }
                : { [c.field === "channels" ? "excludedChannelIds" : "excludedRoleIds"]: c.ids }
            operation = { type: "settings", expectedRevision: settings.settings.revision, patch }
        }
        if (c.type === "map" || c.type === "unmap" || c.type === "clear") {
            // The mapping revision read here fences this read-modify-write against concurrent mapping changes.
            const settings = yield* query({ type: "settings" })
            if (settings.type !== "settings") return yield* Effect.fail(new LevelingHandlingError({ stage: "response" }))
            const mappings = c.type === "clear" ? [] : settings.settings.mappings.filter(m => m.level !== c.level)
            if (c.type === "map") mappings.push({ level: c.level, roleId: c.roleId })
            if (mappings.length > 20 || new Set(mappings.map(m => m.roleId)).size !== mappings.length) { yield* reply("Use at most 20 cumulative mappings with distinct roles and levels"); return }
            const roleIds = mappings.map(m => m.roleId)
            const fresh = yield* readRoleAuthority(context.client, config.serverId, actor.userId, { configuration: true, roleIds, readOnly: mappings.length === 0 })
            currentActor = moderationActor(fresh)
            operation = { type: "mappings", expectedMappingRevision: settings.settings.mappingRevision,
                mappings: mappings.sort((a, b) => a.level - b.level), roles: roleSnapshots(fresh) }
        }
        if (c.type === "correct") operation = { type: "adjust", userId: c.userId, xp: c.xp, reason: c.reason }
        if (c.type === "reset-member") operation = { type: "reset-member", userId: c.userId, confirm: "reset-member", reason: c.reason }
        if (c.type === "reset-server") operation = { type: "reset-server", confirm: "reset-server", reason: c.reason }
        if (c.type === "reconcile") operation = { type: "reconcile", ...(c.userId ? { userId: c.userId } : {}) }
        if (!operation) return
        const createdAt = yield* sourceTimestamp(context.message)
        const result = yield* store.manage({ serverId: config.serverId, actor: currentActor, messageId: context.message.id, createdAt, operation })
        if (result.duplicate) { yield* reply("This leveling command was already recorded. Read current state before issuing another change"); return }
        if (worker) yield* worker.notify()
        if (result.type === "settings") yield* reply(formatSettings(result.settings))
        else if (result.type === "profile") yield* reply(`Member ${result.profile.userId}: ${result.profile.xp} XP, level ${result.profile.level}, audit ${result.audit.auditNo}`)
        else if (result.type === "reset") yield* reply(`Server scores reset, audit ${result.audit.auditNo}. Owned reward withdrawal will continue in bounded work`)
        else yield* reply(`Level reward reconciliation ${result.queued ? "Queued" : "Already current"}. Inspect ${prefix}level status`)
    })
    const correction = invocation.name === "level" && !("error" in invocation.command) && invocation.command.type === "correct"
    return work.pipe(Effect.catch(error => error instanceof LevelingStoreError
        ? reply(correction && error.status === 409 ? "A newer correction was already applied to this member, so this older one was not. Read their current XP before correcting again" : withPrefix(levelingErrorMessage(error), prefix))
        : reply("Current leveling membership or safe role permission could not be verified. Inspect current state before another change")))
}
