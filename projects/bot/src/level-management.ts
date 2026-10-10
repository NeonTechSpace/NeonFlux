import type * as C from "@neonflux/backend/contracts"
import { format, type BotEventContext } from "@neontechspace/fluxerly/effect"
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
import { sourceTimestamp } from "./responses.ts"
import { ago, code, duration, onOff, replyCard, replyText, snippet, usage, type Card } from "./reply-style.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import type { startLevelRoleWorker } from "./level-worker.ts"

export type LevelInvocation = { name: "level", command: LevelCommand | { error: string } }
    | { name: "rank", command: ReturnType<typeof parseRankCommand> }
    | { name: "leaderboard", command: ReturnType<typeof parseLeaderboardCommand> }
const listed = (mentions: readonly string[], noun: string) => mentions.length <= 5 ? mentions.join(", ") : `${mentions.length} ${noun}`
/** The one setting or role reward a command changed, with its new value */
function settingsChange(c: LevelCommand, s: C.LevelingSettings) {
    switch (c.type) {
        case "module": return `Leveling is ${onOff(s.enabled).toLowerCase()}`
        case "rate": return `Members now earn ${s.xpPerMessage} XP at most every ${duration(s.cooldownSeconds)}`
        // A long list is named by its count, since !level config channels or roles pages it
        case "exclude": return c.field === "channels" ? s.excludedChannelIds.length ? `Leveling now skips messages in ${listed(s.excludedChannelIds.map(format.channelMention), "channels")}` : "Leveling now counts messages in every channel"
            : s.excludedRoleIds.length ? `Leveling now skips members with ${listed(s.excludedRoleIds.map(format.roleMention), "roles")}` : "Leveling now counts members with any role"
        case "map": return `Level ${c.level} now gives ${format.roleMention(c.roleId)}`
        case "unmap": return `Level ${c.level} no longer gives a role`
        case "clear": return "Role rewards cleared. NeonFlux removes the reward roles it gave over the next few minutes"
        default: return "Leveling settings saved"
    }
}
const count = (n: number, limit: number) => n ? usage(n, limit) : "None"
/** The settings in counts. Each list shows on its own with `!level config channels`, `roles` or `rewards` */
const settingsCard = (s: C.LevelingSettings, prefix: string): Card => ({ title: "Leveling", fields: [["Status", onOff(s.enabled)], ["Rate", `${s.xpPerMessage} XP at most every ${duration(s.cooldownSeconds)}`],
    ["Excluded channels", count(s.excludedChannelIds.length, 50)], ["Excluded roles", count(s.excludedRoleIds.length, 50)], ["Role rewards", count(s.mappings.length, 20)]],
    ...(s.excludedChannelIds.length || s.excludedRoleIds.length || s.mappings.length ? { note: `Send ${code(`${prefix}level config channels`)}, ${code("roles")} or ${code("rewards")} to see one list` } : {}) })
const configLists = { channels: ["Excluded channels", "Leveling counts messages in every channel"], roles: ["Excluded roles", "Leveling counts members with any role"], rewards: ["Role rewards", "No role rewards yet"] } as const
const CONFIG_PAGE = 10
const auditNames: Record<C.LevelingAudit["type"], string> = { adjust: "XP corrected", "reset-member": "Member reset", "reset-server": "Server reset" }

export function handleLevelCommand(store: LevelingStore, config: BotConfig, invocation: LevelInvocation,
    context: BotEventContext<"messageCreate">, worker?: Effect.Success<ReturnType<typeof startLevelRoleWorker>>) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, content), card = (value: Card) => replyCard(context, config.serverId, value)
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
            yield* card(rankCard(result.profile.userId, result.profile.xp, rank.type === "exact" ? rank.position : rank.type === "range" ? { from: rank.from, to: rank.to } : rank.type))
            return
        }
        if (invocation.name === "leaderboard" && !("error" in invocation.command)) {
            const key = pageKey(config.serverId, context.message, "leaderboard"), cursor = invocation.command.next ? nextPosition<C.LevelingLeaderboardCursor>(key) : undefined
            if (invocation.command.next && !cursor) { yield* reply(noNextPage(`${prefix}leaderboard`)); return }
            // A server reset refuses the remembered position, so a failed page forgets it and the list starts again
            const result = yield* query({ type: "leaderboard", ...(cursor ? { cursor } : {}) }).pipe(Effect.tapError(() => Effect.sync(() => rememberPosition(key, undefined))))
            if (result.type !== "leaderboard") return yield* Effect.fail(new LevelingHandlingError({ stage: "response" }))
            rememberPosition(key, result.nextCursor)
            yield* card({ title: "Message XP leaderboard", description: result.profiles.map(p => `${format.userMention(p.userId)}: Level ${p.level}, ${p.xp.toLocaleString("en-US")} XP`).join("\n") || "No one has XP yet",
                fields: result.nextCursor ? [["Next", code(`${prefix}leaderboard next`)]] : [] })
            return
        }
        if (invocation.name !== "level" || "error" in invocation.command) return
        const c = invocation.command
        if (c.type === "config" && c.list) {
            const start = `${prefix}level config ${c.list}`, key = pageKey(config.serverId, context.message, "level config", c.list), page = c.next ? nextPosition<number>(key) : 1
            if (page === undefined) { yield* reply(noNextPage(start)); return }
            const result = yield* query({ type: "settings" })
            if (result.type !== "settings") return yield* Effect.fail(new LevelingHandlingError({ stage: "response" }))
            const s = result.settings, [title, empty] = configLists[c.list]
            const items = c.list === "channels" ? s.excludedChannelIds.map(format.channelMention) : c.list === "roles" ? s.excludedRoleIds.map(format.roleMention)
                : s.mappings.map(m => `Level ${m.level}: ${format.roleMention(m.roleId)}`)
            // A change since the last page can shorten the list, so next shows its last page at most
            const pages = Math.max(1, Math.ceil(items.length / CONFIG_PAGE)), shown = Math.min(page, pages)
            rememberPosition(key, shown < pages ? shown + 1 : undefined)
            yield* card({ title, description: items.slice((shown - 1) * CONFIG_PAGE, shown * CONFIG_PAGE).join("\n") || empty, fields: shown < pages ? [["Next", code(`${start} next`)]] : [],
                ...(c.list === "rewards" && items.length ? { footer: "Members keep every reward up to their level" } : {}) })
            return
        }
        if (c.type === "config" || c.type === "status" || c.type === "audit") {
            const key = pageKey(config.serverId, context.message, "level audit"), before = c.type === "audit" && c.next ? nextPosition<number>(key) : undefined
            if (c.type === "audit" && c.next && before === undefined) { yield* reply(noNextPage(`${prefix}level audit`)); return }
            const result = yield* query(c.type === "config" ? { type: "settings" } : c.type === "status" ? { type: "status" }
                : { type: "audits", ...(before !== undefined ? { beforeAuditNo: before } : {}) })
            if (result.type === "settings") yield* card(settingsCard(result.settings, prefix))
            else if (result.type === "status") yield* card({ title: "Level rewards", fields: [["Full check", result.sweepPending ? "Running" : "Done"],
                ["Waiting for role updates", result.dirty ? `${result.dirty} member${result.dirty === 1 ? "" : "s"}` : "None"], ["Members with XP", String(result.profiles)]] })
            else if (result.type === "audits") {
                rememberPosition(key, result.nextBeforeAuditNo)
                yield* card({ title: "XP changes by staff", description: result.audits.map(a => `**${auditNames[a.type]}** by ${format.userMention(a.actorId)} ${ago(a.createdAt)}${a.userId ? `: ${format.userMention(a.userId)} ${a.beforeXp} → ${a.afterXp} XP` : ""}. Reason: ${snippet(a.reason, 80)}`).join("\n")
                    || "No XP changes by staff yet", fields: result.nextBeforeAuditNo ? [["Next", code(`${prefix}level audit next`)]] : [] })
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
            yield* reply(`${c.type === "clear" ? "Clearing the role rewards removes the reward roles NeonFlux gave" : `Resetting sets ${c.type === "reset-server" ? "every member's" : `${format.userMention(c.userId)}'s`} XP to 0 and removes the reward roles NeonFlux gave. Message cooldowns stay`}\nConfirm: ${code(command)}`)
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
            if (mappings.length > 20 || new Set(mappings.map(m => m.roleId)).size !== mappings.length) { yield* reply("A server has at most 20 role rewards, each with its own role"); return }
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
        if (result.duplicate) { yield* reply("This leveling command was already done. Check the current settings before you change them again"); return }
        if (worker) yield* worker.notify()
        if (result.type === "settings") yield* reply(settingsChange(c, result.settings))
        else if (result.type === "profile") yield* reply(`${format.userMention(result.profile.userId)} now has ${result.profile.xp.toLocaleString("en-US")} XP, level ${result.profile.level}`)
        else if (result.type === "reset") yield* reply("Every member's XP is reset. NeonFlux removes the reward roles it gave over the next few minutes")
        else yield* reply(result.queued ? `Checking level reward roles now. See ${code(`${prefix}level status`)}` : "Level reward roles are already up to date")
    })
    const correction = invocation.name === "level" && !("error" in invocation.command) && invocation.command.type === "correct"
    return work.pipe(Effect.catch(error => error instanceof LevelingStoreError
        ? reply(correction && error.status === 409 ? "A newer correction was already applied to this member, so this older one was not. Check their current XP before correcting again" : withPrefix(levelingErrorMessage(error), prefix))
        : reply("NeonFlux couldn't confirm your membership or the role permissions. Check them before you try again")))
}
