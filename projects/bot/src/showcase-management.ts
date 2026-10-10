import type * as C from "@neonflux/backend/contracts"
import { ChannelType, format, Permissions, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { fixSentence, permissionNames } from "./permission-fix.ts"
import { sourceTimestamp } from "./responses.ts"
import { code, duration, notSetUp, onOff, replyCard, replyText, usage, type Card } from "./reply-style.ts"
import { channelPermissionInput } from "./safety-permissions.ts"
import { showcaseHelp, type MemberAccessListCommand, type ShowcaseCommand } from "./showcase-command.ts"
import { ShowcaseStoreError, type ShowcaseStore } from "./showcase-store.ts"

/** A member feature's command word and its name in titles, such as showcase and Showcase */
export type MemberFeature = { readonly command: string, readonly title: string }
/** Each access list holds up to 100 roles and 100 members */
const ACCESS_LIMIT = 100
/** Access list entries on one page of an access allowed or blocked list */
const ACCESS_PAGE = 10
/** Who may use a member feature, by its allow and block lists */
export const memberAccessWho = (access: C.MemberAccessLists) => !access.allowRoleIds.length && !access.allowUserIds.length ? "Every member who is not blocked" : "Only allowed members who are not blocked"
/** One list's size, such as 3 roles, 12 members or None */
const accessCount = (roleIds: readonly string[], userIds: readonly string[]) => ([[roleIds.length, "role"], [userIds.length, "member"]] as const).filter(([count]) => count > 0)
    .map(([count, noun]) => `${usage(count, ACCESS_LIMIT)} ${noun}${count === 1 ? "" : "s"}`).join(", ") || "None"
/** The access lists of a member feature, such as showcases, profiles or the role picker, as counts. The lists themselves page with access allowed and access blocked */
export function memberAccessCard(access: C.MemberAccessLists, feature: MemberFeature, prefix: string): Card {
    const listed = access.allowRoleIds.length + access.allowUserIds.length + access.blockRoleIds.length + access.blockUserIds.length > 0
    return { title: `${feature.title} access`, fields: [["Who can use it", memberAccessWho(access)], ["Allowed", accessCount(access.allowRoleIds, access.allowUserIds)],
        ["Blocked", accessCount(access.blockRoleIds, access.blockUserIds)]], footer: "A block always wins over an allow",
        ...listed ? { note: `List them with ${code(`${prefix}${feature.command} access allowed`)} or ${code(`${prefix}${feature.command} access blocked`)}` } : {} }
}
/** Reply with one page of the allow or block list, its roles and then its members, 10 entries at a time */
export function replyMemberAccessList(context: BotEventContext<"messageCreate">, serverId: string, access: C.MemberAccessLists, command: MemberAccessListCommand, feature: MemberFeature) {
    const { message } = context, prefix = replyPrefix(serverId, message.guildId), word = command.list === "allow" ? "allowed" : "blocked"
    const key = pageKey(serverId, message, feature.command, "access", command.list), next = command.next ? nextPosition<number>(key) : 1
    if (next === undefined) return replyText(context, withPrefix(noNextPage(`!${feature.command} access ${word}`), prefix))
    const roleIds = command.list === "allow" ? access.allowRoleIds : access.blockRoleIds, userIds = command.list === "allow" ? access.allowUserIds : access.blockUserIds
    // Entries removed since the last page can shorten the list, so next shows its last page at most
    const pages = Math.max(1, Math.ceil((roleIds.length + userIds.length) / ACCESS_PAGE)), page = Math.min(next, pages)
    rememberPosition(key, page < pages ? page + 1 : undefined)
    const start = (page - 1) * ACCESS_PAGE, end = page * ACCESS_PAGE, title = `${feature.title} ${command.list} list`
    const roles = roleIds.slice(start, end), members = userIds.slice(Math.max(0, start - roleIds.length), Math.max(0, end - roleIds.length))
    return replyCard(context, serverId, !roles.length && !members.length
        ? { title, description: command.list === "allow" ? "Nobody is on the allow list, so every member who is not blocked can use it" : "Nobody is on the block list" }
        : { title, fields: [...roles.length ? [["Roles", roles.map(format.roleMention).join(", ")] as const] : [], ...members.length ? [["Members", members.map(format.userMention).join(", ")] as const] : [],
            ...page < pages ? [["Next", code(`${prefix}${feature.command} access ${word} next`)] as const] : []], footer: accessCount(roleIds, userIds) })
}
/** One access list change in one line, such as Added @Role to the block list for showcases. An allow list change also says who can use the feature now */
export function memberAccessChange(operation: C.MemberAccessOperation, access: C.MemberAccessLists, feature: string) {
    const who = `${memberAccessWho(access)} can use ${feature}`
    if (operation.type === "access-set") return who
    const names = operation.ids.map(operation.kind === "role" ? format.roleMention : format.userMention).join(", ")
    const line = `${operation.type === "access-add" ? `Added ${names} to` : `Removed ${names} from`} the ${operation.list} list for ${feature}`
    return operation.list === "allow" ? `${line}. ${who}` : line
}
function settingsChange(operation: Extract<C.ShowcaseOperation, { type: "settings" }>, settings: C.ShowcaseSettings, prefix: string) {
    const { enabled, channelId, maxPerMember, intervalMinutes } = settings
    if (operation.enabled !== undefined) return !enabled ? "Showcases are off" : channelId ? `Showcases are on in ${format.channelMention(channelId)}`
        : `Showcases are on. Members can post once a channel is set with ${code(`${prefix}showcase channel #channel`)}`
    if (operation.channelId !== undefined) return !channelId ? "Showcases have no channel now, so members cannot post"
        : `Showcases now go to ${format.channelMention(channelId)}${enabled ? "" : `. Members can post once showcases are on with ${code(`${prefix}showcase on`)}`}`
    if (operation.maxPerMember !== undefined) return maxPerMember ? `Each member can now have up to ${maxPerMember} showcase${maxPerMember === 1 ? "" : "s"}` : "Members can now have any number of showcases"
    return intervalMinutes ? `Members now wait ${duration(intervalMinutes * 60)} between showcases` : "Members can now post showcases without waiting"
}
function statusCard(state: C.ShowcaseState, prefix: string): Card {
    const { settings } = state
    return { title: "Showcases", description: !settings.channelId ? `Members cannot post until a channel is set with ${code(`${prefix}showcase channel #channel`)}`
        : settings.enabled ? "Members post their showcases on the website" : `Members cannot post until ${code(`${prefix}showcase on`)}`,
        fields: [["Status", onOff(settings.enabled)], ["Channel", settings.channelId ? format.channelMention(settings.channelId) : "Not set"], ["Who can use it", memberAccessWho(state.access)],
            ["Between posts", settings.intervalMinutes ? duration(settings.intervalMinutes * 60) : "No wait"], ["Per member", settings.maxPerMember ? String(settings.maxPerMember) : "No limit"]] }
}
const statusLabel: Record<C.ShowcaseStatus, string> = { posting: ", being posted", posted: "", unconfirmed: ", not confirmed yet", failed: ", not posted" }
function describe(error: unknown, prefix: string) {
    if (error instanceof ShowcaseStoreError) {
        if (error.status === 403) return "Only the server owner or members with Manage Server can change showcases"
        if (error.status === 409) return withPrefix("Showcase settings changed on the website while this command ran. Check !showcase status and try again", prefix)
        if (error.status === 400) return withPrefix("Check the command. Use !showcase help. Access lists hold up to 100 entries each", prefix)
    }
    return "Showcases are unavailable right now. Try again shortly"
}
const posting = Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks
const showcaseFeature: MemberFeature = { command: "showcase", title: "Showcase" }

export function handleShowcaseCommand(store: ShowcaseStore | undefined, config: BotConfig, command: ShowcaseCommand | { error: string }, context: BotEventContext<"messageCreate">) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, content), card = (value: Card) => replyCard(context, config.serverId, value)
    return Effect.gen(function* () {
        const { client, message } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store) { yield* reply(notSetUp("Showcases")); return }
        if ("error" in command) { yield* reply(withPrefix(command.error, prefix)); return }
        if (command.type === "help") { yield* reply(withPrefix(showcaseHelp, prefix)); return }
        if (command.type === "list") {
            const listed = yield* store.list({ serverId, ...(command.authorId ? { authorId: command.authorId } : {}) })
            yield* card({ title: "Showcases", description: listed.showcases.map(row => `**#${row.showcaseNo}** ${row.title.slice(0, 100)}, by ${format.userMention(row.authorId)} in ${format.channelMention(row.channelId)}${statusLabel[row.status]}`).join("\n")
                || (command.authorId ? "That member has no showcases" : "No showcases yet"), ...listed.more ? { footer: "The 10 newest are shown" } : {} })
            return
        }
        const channelId = command.type === "change" && command.operation.type === "settings" && command.operation.channelId ? command.operation.channelId : undefined
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id, channelId)
        if (!manager) { yield* reply("Only the server owner or members with Manage Server can change showcases"); return }
        if (command.type !== "change") {
            const state = yield* store.settings({ serverId })
            yield* command.type === "access-list" ? replyMemberAccessList(context, serverId, state.access, command, showcaseFeature)
                : card(command.type === "access" ? memberAccessCard(state.access, showcaseFeature, prefix) : statusCard(state, prefix))
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
        yield* reply(operation.type === "settings" ? settingsChange(operation, saved.settings, prefix) : memberAccessChange(operation, saved.access, "showcases"))
    }).pipe(Effect.catch(error => reply(describe(error, prefix))), Effect.asVoid)
}
