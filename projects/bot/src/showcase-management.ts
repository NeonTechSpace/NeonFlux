import type * as C from "@neonflux/backend/contracts"
import { ChannelType, Permissions, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { fixSentence, permissionNames } from "./permission-fix.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { channelPermissionInput } from "./safety-permissions.ts"
import { showcaseHelp, type ShowcaseCommand } from "./showcase-command.ts"
import { ShowcaseStoreError, type ShowcaseStore } from "./showcase-store.ts"

const roles = (ids: readonly string[]) => ids.map(id => `<@&${id}>`).join(", ") || "None"
const users = (ids: readonly string[]) => ids.map(id => `<@${id}>`).join(", ") || "None"
/** The access lists of a member feature, such as "post showcases" */
export function formatMemberAccess(access: C.MemberAccessLists, what: string) {
    const open = !access.allowRoleIds.length && !access.allowUserIds.length
    return [open ? `Every member who is not blocked may ${what}` : `Only allowed members who are not blocked may ${what}`,
        `Allowed roles: ${roles(access.allowRoleIds)}`, `Allowed users: ${users(access.allowUserIds)}`,
        `Blocked roles: ${roles(access.blockRoleIds)}`, `Blocked users: ${users(access.blockUserIds)}`, "A block always wins over an allow"].join("\n")
}
function formatStatus(state: C.ShowcaseState, prefix: string) {
    const { settings } = state
    return [`Showcases: ${settings.enabled ? "On" : "Off"}. Channel: ${settings.channelId ? `<#${settings.channelId}>` : "none"}`,
        `Per member: ${settings.maxPerMember ?? "no limit"}. Between posts: ${settings.intervalMinutes ? `${settings.intervalMinutes} minutes` : "no wait"}`,
        !settings.channelId ? withPrefix("Members cannot post until !showcase channel #channel", prefix) : settings.enabled ? "Members post their showcases on the website" : withPrefix("Members cannot post until !showcase on", prefix),
        formatMemberAccess(state.access, "post showcases").split("\n")[0]!].join("\n")
}
const statusLabel: Record<C.ShowcaseStatus, string> = { posting: ", being posted", posted: "", unconfirmed: ", post unconfirmed", failed: ", not posted" }
function describe(error: unknown, prefix: string) {
    if (error instanceof ShowcaseStoreError) {
        if (error.status === 403) return "Only the server owner or members with Manage Server can change showcases"
        if (error.status === 409) return "Showcase settings changed on the website while this command ran. Check !showcase status and try again"
        if (error.status === 400) return withPrefix("Check the command. Use !showcase help. Access lists hold up to 100 entries each", prefix)
    }
    return "Showcases are unavailable right now. Try again shortly"
}
const posting = Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks

export function handleShowcaseCommand(store: ShowcaseStore | undefined, config: BotConfig, command: ShowcaseCommand | { error: string }, context: BotEventContext<"messageCreate">) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => context.reply({ content, allowedMentions: noMentions })
    return Effect.gen(function* () {
        const { client, message } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store) { yield* reply("Showcase persistence is not configured"); return }
        if ("error" in command) { yield* reply(withPrefix(command.error, prefix)); return }
        if (command.type === "help") { yield* reply(withPrefix(showcaseHelp, prefix)); return }
        if (command.type === "list") {
            const listed = yield* store.list({ serverId, ...(command.authorId ? { authorId: command.authorId } : {}) })
            yield* reply(listed.showcases.length ? [...listed.showcases.map(row => `${row.showcaseNo}. ${row.title.slice(0, 100)}, by <@${row.authorId}> in <#${row.channelId}>${statusLabel[row.status]}`),
                ...listed.more ? ["The 10 newest are shown"] : []].join("\n") : command.authorId ? "That member has no showcases" : "No showcases yet")
            return
        }
        const channelId = command.type === "change" && command.operation.type === "settings" && command.operation.channelId ? command.operation.channelId : undefined
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id, channelId)
        if (!manager) { yield* reply("Only the server owner or members with Manage Server can change showcases"); return }
        if (command.type !== "change") {
            const state = yield* store.settings({ serverId })
            yield* reply(command.type === "access" ? formatMemberAccess(state.access, "post showcases") : formatStatus(state, prefix))
            return
        }
        const operation = command.operation
        if (channelId) {
            // The bot posts showcases as itself, so it checks its own permissions in the channel now and names what it lacks
            const channel = authority.channel
            if (channel?.type !== ChannelType.Text && channel?.type !== ChannelType.Announcement) { yield* reply("Choose a text or announcement channel of this server"); return }
            const missing = posting & ~client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, ...channelPermissionInput(authority) })
            if (missing) { yield* reply(fixSentence({ permissions: permissionNames(missing), channelId })); return }
        }
        if (operation.type === "access-add" && operation.kind === "role" && operation.ids.some(id => id === serverId || !authority.roles.some(role => role.id === id))) {
            yield* reply("Name existing roles of this server. Leave the allow list empty for everyone instead of using the everyone role")
            return
        }
        const saved = yield* store.manage({ serverId, originServerId: serverId, messageId: message.id, createdAt: yield* sourceTimestamp(message), actor, managerAuthorized: true, operation })
        yield* reply(operation.type === "settings" ? formatStatus(saved, prefix) : `Access lists saved\n${formatMemberAccess(saved.access, "post showcases")}`)
    }).pipe(Effect.catch(error => reply(describe(error, prefix))), Effect.asVoid)
}
