import type * as C from "@neonflux/backend/contracts"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { profileHelp, type ProfileCommand } from "./profile-command.ts"
import { ProfileStoreError, type ProfileStore } from "./profile-store.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { formatMemberAccess } from "./showcase-management.ts"

// When each member may run !profile again, per server. The cooldown is kept in memory, so a restart clears it
const cooldowns = new Map<string, number>()
const COOLDOWN_ENTRIES = 10000
function formatStatus(state: C.ProfileState, prefix: string) {
    return [`Profiles: ${state.settings.enabled ? "On" : "Off"}. Cooldown: ${state.settings.cooldownSeconds ? `${state.settings.cooldownSeconds} seconds` : "none"}`,
        state.settings.enabled ? "Members edit their profile on the website and show it with !profile" : withPrefix("Members cannot use profiles until !profile on", prefix),
        formatMemberAccess(state.access, "use profiles").split("\n")[0]!].join("\n")
}
function describe(error: unknown, prefix: string) {
    if (error instanceof ProfileStoreError) {
        if (error.status === 403) return "Only the server owner or members with Manage Server can change profiles"
        if (error.status === 409) return "Profile settings changed on the website while this command ran. Check !profile status and try again"
        if (error.status === 400) return withPrefix("Check the command. Use !profile help. Access lists hold up to 100 entries each", prefix)
    }
    return "Profiles are unavailable right now. Try again shortly"
}

export function handleProfileCommand(store: ProfileStore | undefined, config: BotConfig, command: ProfileCommand | { error: string }, context: BotEventContext<"messageCreate">) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => context.reply({ content, allowedMentions: noMentions })
    return Effect.gen(function* () {
        const { client, message } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store) { yield* reply("Profile persistence is not configured"); return }
        if ("error" in command) { yield* reply(withPrefix(command.error, prefix)); return }
        if (command.type === "help") { yield* reply(withPrefix(profileHelp, prefix)); return }
        if (command.type === "show") {
            const callerId = message.author.id, targetId = command.userId ?? callerId, key = `${serverId}:${callerId}`, now = yield* Clock.currentTimeMillis
            const waitUntil = cooldowns.get(key) ?? 0
            if (waitUntil > now) { yield* reply(`You can show a profile again in ${Math.ceil((waitUntil - now) / 1000)} seconds`); return }
            // Fresh reads of both members, for the access lists and the name the profile shows
            const authority = yield* readSafetyAuthority(client, serverId, callerId, targetId === callerId ? {} : { targetId, allowAbsentTarget: true })
            const target = targetId === callerId ? authority.actor : authority.target
            if (!target) { yield* reply("That member is not in this server"); return }
            const result = yield* store.show({ serverId, channelId: message.channelId, caller: { userId: callerId, roleIds: [...authority.actor.roleIds] },
                target: { userId: targetId, userName: (target.nickname ?? target.username).slice(0, 100), roleIds: [...target.roleIds] } })
            if (result.type === "refused") {
                yield* reply(result.reason === "off" ? "Profiles are turned off in this server" : result.reason === "access" ? "You cannot use profiles in this server"
                    : result.reason === "automod" ? `The server's automod rule ${result.rule} blocks this profile` : targetId === callerId ? "You have no profile yet. Create one on the NeonFlux website" : "That member has no profile")
                return
            }
            yield* context.reply({ content: result.content.content, embeds: result.content.embed ? [result.content.embed] : [], allowedMentions: noMentions })
            if (result.cooldownSeconds) {
                if (cooldowns.size >= COOLDOWN_ENTRIES) for (const [entry, until] of cooldowns) if (until <= now) cooldowns.delete(entry)
                cooldowns.set(key, now + result.cooldownSeconds * 1000)
            }
            return
        }
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id)
        if (!manager) { yield* reply("Only the server owner or members with Manage Server can change profiles"); return }
        if (command.type !== "change") {
            const state = yield* store.settings({ serverId })
            yield* reply(command.type === "access" ? formatMemberAccess(state.access, "use profiles") : formatStatus(state, prefix))
            return
        }
        const operation = command.operation
        if (operation.type === "access-add" && operation.kind === "role" && operation.ids.some(id => id === serverId || !authority.roles.some(role => role.id === id))) {
            yield* reply("Name existing roles of this server. Leave the allow list empty for everyone instead of using the everyone role")
            return
        }
        const saved = yield* store.manage({ serverId, originServerId: serverId, messageId: message.id, createdAt: yield* sourceTimestamp(message), actor, managerAuthorized: true, operation })
        yield* reply(operation.type === "settings" ? formatStatus(saved, prefix) : `Access lists saved\n${formatMemberAccess(saved.access, "use profiles")}`)
    }).pipe(Effect.catch(error => reply(describe(error, prefix))), Effect.asVoid)
}
