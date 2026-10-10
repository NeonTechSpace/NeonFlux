import type * as C from "@neonflux/backend/contracts"
import { format, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { moderationActor } from "./moderation.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { sourceTimestamp } from "./responses.ts"
import { code, notSetUp, replyCard, replyText, usage, type Card } from "./reply-style.ts"
import { readRoleAuthority, rolePermissionFix } from "./role-permissions.ts"
import { roleSnapshots } from "./roles.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { memberAccessCard, memberAccessChange, memberAccessWho, replyMemberAccessList, type MemberFeature } from "./showcase-management.ts"
import { rolePickerHelp, type RolePickerCommand } from "./rolepicker-command.ts"
import { RolePickerStoreError, rolePickerDisplay, rolePickerErrorMessage, type RolePickerStore } from "./rolepicker-store.ts"

type Menu = C.RolePickerSettings["menus"][number]
const rolePickerFeature: MemberFeature = { command: "rolepicker", title: "Role picker" }
/** Menu roles on one page of !rolepicker menu show */
const ROLE_PAGE = 10
const roles = (ids: readonly string[]) => ids.map(format.roleMention).join(", ") || "None"
/** A menu's role count, which names the limit of 25 once it is nearly reached */
const roleCount = (count: number) => `${usage(count, 25)} role${count === 1 ? "" : "s"}`
const modeLabel = (mode: C.RolePickerMode) => mode === "single" ? "Single choice" : "Multiple choice"
const modeName = (mode: C.RolePickerMode) => modeLabel(mode).toLowerCase()
/** One menu on one line, such as colors Single choice, 12 roles */
const menuLine = (menu: Menu) => `**${menu.name}** ${modeLabel(menu.mode)}, ${roleCount(menu.roleIds.length)}`
/** One menu with its mode, description and one page of its roles */
function menuCard(menu: Menu, page: number, pages: number, prefix: string): Card {
    const roleIds = menu.roleIds.slice((page - 1) * ROLE_PAGE, page * ROLE_PAGE)
    return { title: `Menu ${menu.name}`, ...menu.description ? { description: menu.description } : {}, fields: [["Mode", modeLabel(menu.mode)],
        ["Roles", roleIds.length ? roles(roleIds) : `None yet. Add some with ${code(`${prefix}rolepicker menu role add ${menu.name} @roles`)}`],
        ...page < pages ? [["Next", code(`${prefix}rolepicker menu show ${menu.name} next`)] as const] : []], ...menu.roleIds.length ? { footer: roleCount(menu.roleIds.length) } : {} }
}
const statusCard = (state: C.RolePickerState, prefix: string): Card => ({ title: "Role picker", fields: [
    ["Status", state.settings.enabled ? "On. Members choose roles from these menus on the website" : `Off. Turn it on with ${code(`${prefix}rolepicker on`)}`],
    ["Who can use it", memberAccessWho(state.access)], ["Menus", usage(state.settings.menus.length, 10)]] })
/** One line that names what a change did */
function savedReply(operation: C.RolePickerOperation, state: C.RolePickerState, prefix: string) {
    if (operation.type === "module") return operation.enabled ? "Role picker on. Members choose roles on the website" : "Role picker off"
    if (!("name" in operation)) return memberAccessChange(operation, state.access, "the role picker")
    if (operation.type === "menu-remove") return `Menu ${operation.name} removed. Roles members already chose stay with them`
    const menu = state.settings.menus.find(row => row.name === operation.name)
    if (!menu || operation.type === "menu-set") return `Menu ${operation.name} saved`
    if (operation.type === "menu-add") return `Menu ${menu.name} added with ${modeName(menu.mode)}. Add its roles with ${code(`${prefix}rolepicker menu role add ${menu.name} @roles`)}`
    if (operation.type === "menu-update") return operation.mode ? `Menu ${menu.name} is ${modeName(menu.mode)} now` : menu.description ? `Menu ${menu.name} now has the description: ${menu.description}` : `Menu ${menu.name} has no description now`
    return operation.type === "menu-role-add" ? `Added ${roles(operation.roleIds)} to menu ${menu.name}, which has ${roleCount(menu.roleIds.length)} now`
        : `Removed ${roles(operation.roleIds)} from menu ${menu.name}. Members who chose them keep them`
}

export function handleRolePickerCommand(store: RolePickerStore | undefined, config: BotConfig, command: RolePickerCommand | { error: string }, context: BotEventContext<"messageCreate">) {
    const reply = (content: string) => replyText(context, content), card = (value: Card) => replyCard(context, config.serverId, value)
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    return Effect.gen(function* () {
        if (context.message.guildId !== config.serverId) return
        if (!store) { yield* reply(notSetUp("Role picker")); return }
        if ("error" in command) { yield* reply(withPrefix(command.error, prefix)); return }
        if (command.type === "help") { yield* reply(withPrefix(rolePickerHelp, prefix)); return }
        const { client, message } = context, serverId = config.serverId
        // The same rule as other role settings: The server owner or an Administrator
        const authority = yield* readSafetyAuthority(client, serverId, message.author.id)
        if (!authority.isOwner && !authority.isAdmin) { yield* reply("Only the server owner or an administrator can manage the role picker"); return }
        const actor = moderationActor(authority)
        if (command.type !== "change") {
            const current = yield* store.settings({ serverId, actor }), menus = current.settings.menus
            if (command.type === "access-list") { yield* replyMemberAccessList(context, serverId, current.access, command, rolePickerFeature); return }
            if (command.type === "menu") {
                const menu = menus.find(row => row.name === command.name), key = pageKey(serverId, message, "rolepicker", "menu", command.name), next = command.next ? nextPosition<number>(key) : 1
                if (!menu || next === undefined) {
                    yield* reply(withPrefix(menu ? noNextPage(`!rolepicker menu show ${command.name}`) : `No menu is named ${command.name}. Check !rolepicker menu list`, prefix))
                    return
                }
                // Roles removed since the last page can shorten the list, so next shows its last page at most
                const pages = Math.max(1, Math.ceil(menu.roleIds.length / ROLE_PAGE)), page = Math.min(next, pages)
                rememberPosition(key, page < pages ? page + 1 : undefined)
                yield* card(menuCard(menu, page, pages, prefix))
                return
            }
            yield* card(command.type === "access" ? memberAccessCard(current.access, rolePickerFeature, prefix) : command.type === "list"
                ? { title: "Role picker menus", ...menus.length ? { description: menus.map(menuLine).join("\n"), note: `Show one with ${code(`${prefix}rolepicker menu show <name>`)}` }
                    : { description: `No menus yet. Add one with ${code(`${prefix}rolepicker menu add <name> single|multi`)}` } } : statusCard(current, prefix))
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
