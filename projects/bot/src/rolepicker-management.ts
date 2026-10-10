import type * as C from "@neonflux/backend/contracts"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { moderationActor } from "./moderation.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { readRoleAuthority, rolePermissionFix } from "./role-permissions.ts"
import { roleSnapshots } from "./roles.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { rolePickerHelp, type RolePickerCommand } from "./rolepicker-command.ts"
import { RolePickerStoreError, rolePickerDisplay, rolePickerErrorMessage, type RolePickerStore } from "./rolepicker-store.ts"

const roles = (ids: readonly string[]) => ids.map(id => `<@&${id}>`).join(", ") || "None"
const users = (ids: readonly string[]) => ids.map(id => `<@${id}>`).join(", ") || "None"
export function formatRolePickerMenus(settings: C.RolePickerSettings) {
    if (!settings.menus.length) return "No menus yet"
    return settings.menus.map(menu => `${menu.name}: ${menu.mode === "single" ? "Single choice" : "Multiple choice"}, ${menu.roleIds.length} of 25 roles${menu.description ? `\n${menu.description}` : ""}\nRoles: ${roles(menu.roleIds)}`).join("\n\n")
}
export function formatRolePickerAccess(access: C.MemberAccessLists) {
    const open = !access.allowRoleIds.length && !access.allowUserIds.length
    return [open ? "Every member who is not blocked may use the role picker" : "Only allowed members who are not blocked may use the role picker",
        `Allowed roles: ${roles(access.allowRoleIds)}`, `Allowed users: ${users(access.allowUserIds)}`,
        `Blocked roles: ${roles(access.blockRoleIds)}`, `Blocked users: ${users(access.blockUserIds)}`, "A block always wins over an allow"].join("\n")
}
function formatStatus(state: C.RolePickerState, prefix: string) {
    return [`Role picker: ${state.settings.enabled ? "On" : "Off"}. Menus: ${state.settings.menus.length} of 10`,
        state.settings.enabled ? "Members choose roles from these menus on the website" : withPrefix("Members cannot use it until !rolepicker on", prefix),
        formatRolePickerAccess(state.access).split("\n")[0]!].join("\n")
}
function savedReply(operation: C.RolePickerOperation, state: C.RolePickerState, prefix: string) {
    if (operation.type === "module") return formatStatus(state, prefix)
    if (!("name" in operation)) return `Access lists saved\n${formatRolePickerAccess(state.access)}`
    if (operation.type === "menu-remove") return `Menu ${operation.name} removed. Roles members already chose stay with them`
    const menu = state.settings.menus.find(row => row.name === operation.name)
    return menu ? `Menu saved\n${formatRolePickerMenus({ enabled: state.settings.enabled, menus: [menu] })}` : "Menu saved"
}

export function handleRolePickerCommand(store: RolePickerStore | undefined, config: BotConfig, command: RolePickerCommand | { error: string }, context: BotEventContext<"messageCreate">) {
    const reply = (content: string) => Effect.gen(function* () {
        for (let index = 0; index < content.length; index += 1900) yield* context.reply({ content: content.slice(index, index + 1900), allowedMentions: noMentions })
    })
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    return Effect.gen(function* () {
        if (context.message.guildId !== config.serverId) return
        if (!store) { yield* reply("Role picker persistence is not configured"); return }
        if ("error" in command) { yield* reply(withPrefix(command.error, prefix)); return }
        if (command.type === "help") { yield* reply(withPrefix(rolePickerHelp, prefix)); return }
        const { client, message } = context, serverId = config.serverId
        // The same rule as other role settings: The server owner or an Administrator
        const authority = yield* readSafetyAuthority(client, serverId, message.author.id)
        if (!authority.isOwner && !authority.isAdmin) { yield* reply("Only the server owner or an administrator can manage the role picker"); return }
        const actor = moderationActor(authority)
        if (command.type !== "change") {
            const current = yield* store.settings({ serverId, actor })
            yield* reply(command.type === "access" ? formatRolePickerAccess(current.access) : command.type === "list" ? formatRolePickerMenus(current.settings) : formatStatus(current, prefix))
            return
        }
        const operation = command.operation
        let snapshots: C.RolesRoleSnapshot[] | undefined
        if (operation.type === "menu-role-add") {
            // Menu roles pass the shared self-service rules on a fresh native read: Below the bot and you, and no staff permissions
            const fresh = yield* readRoleAuthority(client, serverId, message.author.id, { configuration: true, roleIds: operation.roleIds }).pipe(
                Effect.map(value => ({ value })), Effect.catchTag("RolePermissionError", error => Effect.succeed({ error })))
            if (!("value" in fresh)) {
                yield* reply(rolePermissionFix(fresh.error) ?? "Current role permissions could not be confirmed. Try again shortly")
                return
            }
            snapshots = roleSnapshots(fresh.value)
        }
        if (operation.type === "access-add" && operation.kind === "role" && operation.ids.some(id => id === serverId || !authority.roles.some(role => role.id === id))) {
            yield* reply("Name existing roles of this server. Leave the allow list empty for everyone instead of using the everyone role")
            return
        }
        // Every save refreshes the role names stored with the menus from this fresh read
        const saved = yield* store.manage({ serverId, messageId: message.id, createdAt: yield* sourceTimestamp(message), actor, ...(snapshots ? { roles: snapshots } : {}),
            display: rolePickerDisplay(serverId, authority.roles), operation })
        yield* reply(savedReply(operation, saved, prefix))
    }).pipe(Effect.catch(error => reply(error instanceof RolePickerStoreError ? withPrefix(rolePickerErrorMessage(error), prefix) : "The role picker change could not be confirmed. Try again shortly")), Effect.asVoid)
}
