import { MEMBER_ACCESS_ROLES, MEMBER_ACCESS_USERS } from "@neonflux/contracts/shared"
import type { ProfileState } from "@neonflux/contracts/profiles"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import { readChannelParent } from "./channel-parents.ts"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { profileHelp, type ProfileCommand } from "./profile-command.ts"
import { ProfileStoreError, type ProfileStore } from "./profile-store.ts"
import { sourceTimestamp } from "./responses.ts"
import { clip, code, duration, notSetUp, onOff, replyCard, replyText, type Card } from "./reply-style.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import {
    memberAccessCard,
    memberAccessChange,
    memberAccessWho,
    replyMemberAccessList,
    type MemberFeature,
} from "./rolepicker-management.ts"

// When each member last ran !profile per server, and when that show's cooldown ends. The cooldown is kept in memory,
// so a restart clears it
const cooldowns = new Map<string, { readonly shownAt: number; readonly until: number }>()
const COOLDOWN_ENTRIES = 10000
const profileFeature: MemberFeature = { command: "profile", title: "Profile" }
const statusCard = (state: ProfileState, prefix: string): Card => ({
    title: "Profiles",
    description: state.settings.enabled
        ? `Members edit their profile on the website and show it with ${code(`${prefix}profile`)}`
        : `Members cannot use profiles until ${code(`${prefix}profile on`)}`,
    fields: [
        ["Status", onOff(state.settings.enabled)],
        ["Who can use it", memberAccessWho(state.access)],
        ["Cooldown", state.settings.cooldownSeconds ? duration(state.settings.cooldownSeconds) : "None"],
    ],
})
function describe(error: unknown, prefix: string) {
    if (error instanceof ProfileStoreError) {
        if (error.status === 403) return "Only the server owner or members with Manage community can change profiles"
        if (error.status === 409)
            return withPrefix(
                "Profile settings changed on the website while this command ran. Check !profile status and try again",
                prefix,
            )
        if (error.status === 400)
            return withPrefix(
                `Check the command. Use !profile help. Access lists hold up to ${MEMBER_ACCESS_ROLES} roles or ${MEMBER_ACCESS_USERS} members each`,
                prefix,
            )
    }
    return "Profiles are unavailable right now. Try again shortly"
}

export function handleProfileCommand(
    store: ProfileStore | undefined,
    config: BotConfig,
    command: ProfileCommand | { error: string },
    context: BotEventContext<"messageCreate">,
) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, content),
        card = (value: Card) => replyCard(context, config.serverId, value)
    return Effect.gen(function* () {
        const { client, message } = context,
            serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store) {
            yield* reply(notSetUp("Member profiles"))
            return
        }
        if ("error" in command) {
            yield* reply(withPrefix(command.error, prefix))
            return
        }
        if (command.type === "help") {
            yield* reply(withPrefix(profileHelp, prefix))
            return
        }
        if (command.type === "show") {
            const callerId = message.author.id,
                targetId = command.userId ?? callerId,
                key = `${serverId}:${callerId}`,
                now = yield* Clock.currentTimeMillis
            const last = cooldowns.get(key)
            if (last && last.until > now) {
                // A shorter or removed cooldown also ends a wait that is already running, and a longer one does not extend it
                const { cooldownSeconds } = (yield* store.settings({ serverId })).settings,
                    waitUntil = Math.min(last.until, last.shownAt + (cooldownSeconds ?? 0) * 1000)
                if (waitUntil > now) {
                    yield* reply(`You can show a profile again in ${duration(Math.ceil((waitUntil - now) / 1000))}`)
                    return
                }
            }
            // Fresh reads of both members, for the access lists and the name the profile shows
            const authority = yield* readSafetyAuthority(
                client,
                serverId,
                callerId,
                targetId === callerId ? {} : { targetId, allowAbsentTarget: true },
            )
            const target = targetId === callerId ? authority.actor : authority.target
            if (!target) {
                yield* reply("That member is not in this server")
                return
            }
            // Automod channel rules treat a thread as its parent channel too
            const parentChannelId = yield* readChannelParent(client, message.channelId)
            const result = yield* store.show({
                serverId,
                channelId: message.channelId,
                ...(parentChannelId ? { parentChannelId } : {}),
                caller: { userId: callerId, roleIds: [...authority.actor.roleIds] },
                target: {
                    userId: targetId,
                    userName: clip(target.nickname ?? target.username, 100, ""),
                    roleIds: [...target.roleIds],
                    joinedAt: target.joinedAt,
                },
            })
            if (result.type === "refused") {
                yield* reply(
                    result.reason === "off"
                        ? "Profiles are turned off in this server"
                        : result.reason === "access"
                          ? "You cannot use profiles in this server"
                          : result.reason === "automod"
                            ? `The server's automod rule ${result.rule} blocks this profile`
                            : targetId === callerId
                              ? "You have no profile yet. Create one on the NeonFlux website"
                              : "That member has no profile",
                )
                return
            }
            yield* context.reply({
                content: result.content.content,
                embeds: result.content.embed ? [result.content.embed] : [],
            })
            if (result.cooldownSeconds) {
                if (cooldowns.size >= COOLDOWN_ENTRIES)
                    for (const [entry, { until }] of cooldowns) if (until <= now) cooldowns.delete(entry)
                cooldowns.set(key, { shownAt: now, until: now + result.cooldownSeconds * 1000 })
            }
            return
        }
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id)
        if (!manager) {
            yield* reply("Only the server owner or members with Manage community can change profiles")
            return
        }
        if (command.type !== "change") {
            const state = yield* store.settings({ serverId })
            yield* command.type === "access-list"
                ? replyMemberAccessList(context, serverId, state.access, command, profileFeature)
                : card(
                      command.type === "access"
                          ? memberAccessCard(state.access, profileFeature, prefix)
                          : statusCard(state, prefix),
                  )
            return
        }
        const operation = command.operation
        if (
            operation.type === "access-add" &&
            operation.kind === "role" &&
            operation.ids.some((id) => id === serverId || !authority.roles.some((role) => role.id === id))
        ) {
            yield* reply(
                "Name existing roles of this server. Leave the allow list empty for everyone instead of using the everyone role",
            )
            return
        }
        const saved = yield* store.manage({
            serverId,
            originServerId: serverId,
            messageId: message.id,
            createdAt: yield* sourceTimestamp(message),
            actor,
            managerAuthorized: true,
            operation,
        })
        const { enabled, cooldownSeconds } = saved.settings
        yield* reply(
            operation.type !== "settings"
                ? memberAccessChange(operation, saved.access, "profiles")
                : operation.enabled !== undefined
                  ? `Profiles are ${onOff(enabled).toLowerCase()}`
                  : cooldownSeconds
                    ? `Members now wait ${duration(cooldownSeconds)} between showing profiles`
                    : "Members can now show profiles without waiting",
        )
    }).pipe(
        Effect.catch((error) => reply(describe(error, prefix))),
        Effect.asVoid,
    )
}
