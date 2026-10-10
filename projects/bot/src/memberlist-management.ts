import type * as C from "@neonflux/backend/contracts"
import type * as D from "@neonflux/backend/dashboard-contracts"
import { hierarchy, Permissions, type BotEventContext, type Client, type GuildMember, type GuildRole, type RoleHoistPosition } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { memberListHelp, parseMemberListCommand } from "./memberlist-command.ts"
import type { MemberListStore } from "./memberlist-store.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { SafetyPermissionError, type SafetyAuthority } from "./safety-permissions.ts"

const int32 = (value: number) => value >= -2147483648 && value <= 2147483647
/** Fluxer groups members under hoisted roles, highest display position first. A role without one uses its hierarchy position */
export const displayPosition = (role: GuildRole) => role.hoistPosition ?? role.position
export function memberListOrder(roles: readonly GuildRole[], serverId: string) {
    return roles.filter(role => role.hoist && role.id !== serverId)
        .sort((a, b) => displayPosition(b) - displayPosition(a) || b.position - a.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
}

/**
 * Display positions that show the desired order, top first. Roles that cannot move keep their current position, and the
 * movable roles between them get positions in between. Only positions that change are returned
 */
export function planMemberList(order: readonly GuildRole[], desired: readonly string[], movable: (role: GuildRole) => boolean): { positions: RoleHoistPosition[] } | { error: string } {
    const byId = new Map(order.map(role => [role.id, role]))
    if (desired.length !== order.length || desired.some(id => !byId.has(id)) || new Set(desired).size !== desired.length) {
        return { error: `Name every role shown in the member list once: ${order.map(role => role.name).join(", ") || "none are hoisted"}` }
    }
    const assigned = new Map<string, number>()
    let pending: GuildRole[] = [], upper: GuildRole | undefined
    const place = (lower: GuildRole | undefined) => {
        const top = upper ? displayPosition(upper) : undefined, bottom = lower ? displayPosition(lower) : undefined
        if (top !== undefined && bottom !== undefined && top - bottom - 1 < pending.length) {
            return pending.length ? `There is no room between ${upper!.name} and ${lower!.name} for the roles you placed there, and those two cannot move. Reset the order first or place the roles elsewhere`
                : `${upper!.name} and ${lower!.name} cannot move, because they are at or above the top role of NeonFlux or yours. Keep them in their current order`
        }
        // Roles that already show in this order between their neighbors keep their positions
        const current = pending.map(displayPosition)
        const fits = current.every((value, index) => (index === 0 ? top === undefined || value < top : value < current[index - 1]!) && (bottom === undefined || value > bottom))
        pending.forEach((role, index) => assigned.set(role.id, fits ? current[index]! : top !== undefined ? top - 1 - index : bottom !== undefined ? bottom + pending.length - index : pending.length - index))
        pending = []
        return undefined
    }
    for (const id of desired) {
        const role = byId.get(id)!
        if (movable(role)) { pending.push(role); continue }
        const problem = place(role)
        if (problem) return { error: problem }
        upper = role
    }
    place(undefined)
    if ([...assigned.values()].some(value => !int32(value))) return { error: "These display positions are out of range. Reset the order first" }
    return { positions: [...assigned].filter(([id, value]) => displayPosition(byId.get(id)!) !== value).map(([id, hoistPosition]) => ({ id, hoistPosition })) }
}

function highest(member: GuildMember, roles: readonly GuildRole[]) {
    return roles.filter(role => member.roleIds.includes(role.id)).reduce<GuildRole | undefined>((top, role) => !top || hierarchy.isAbove(role, top) ? role : top, undefined)
}
/** Fluxer lets the bot move only roles below its top role, and NeonFlux moves only roles below the manager's top role too */
function rules(client: Client, authority: SafetyAuthority) {
    const { guild, roles, actor, bot } = authority, botTop = highest(bot, roles), actorTop = highest(actor, roles)
    const actorBits = client.permissions.calculate({ guild, member: actor, roles }), botBits = client.permissions.calculate({ guild, member: bot, roles })
    return {
        manageRoles: authority.isOwner || (actorBits & (Permissions.Administrator | Permissions.ManageRoles)) !== 0n,
        botManageRoles: bot.userId === guild.ownerId || (botBits & (Permissions.Administrator | Permissions.ManageRoles)) !== 0n,
        movable: (role: GuildRole) => (bot.userId === guild.ownerId || !!botTop && hierarchy.isAbove(botTop, role)) && (authority.isOwner || !!actorTop && hierarchy.isAbove(actorTop, role)),
    }
}

type Change = { type: "set", roleIds: string[] } | { type: "reset" }
/** Checks the manager and the bot, then applies the change natively. Fails with a reason a manager can act on */
function applyMemberList(client: Client, serverId: string, authority: SafetyAuthority, change: Change) {
    return Effect.gen(function* () {
        const check = rules(client, authority)
        if (!check.botManageRoles) return yield* Effect.fail(new MemberListError({ reason: "NeonFlux needs Manage Roles to change the member list" }))
        if (change.type === "reset") {
            if (!authority.isOwner && !authority.isAdmin) return yield* Effect.fail(new MemberListError({ reason: "Only the server owner or an Administrator can reset the member list, because it clears roles above yours too" }))
            yield* client.roles.resetHoistPositions(serverId, { auditReason: "NeonFlux member list reset" })
            return true
        }
        if (!check.manageRoles) return yield* Effect.fail(new MemberListError({ reason: "Changing the member list needs Manage Roles or Administrator" }))
        const plan = planMemberList(memberListOrder(authority.roles, serverId), change.roleIds, check.movable)
        if ("error" in plan) return yield* Effect.fail(new MemberListError({ reason: plan.error }))
        if (!plan.positions.length) return false
        yield* client.roles.setHoistPositions(serverId, plan.positions, { auditReason: "NeonFlux member list order" })
        return true
    })
}
export class MemberListError extends Data.TaggedError("MemberListError")<{ readonly reason: string }> {}

function describe(error: unknown) {
    if (error instanceof MemberListError) return error.reason
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    if (error !== null && typeof error === "object" && (error as { _tag?: unknown })._tag === "GuildOperationError") return "Fluxer refused the change. NeonFlux needs Manage Roles and a top role above every role it moves"
    return "The memberlist command could not be completed"
}

export function handleMemberListCommand(store: MemberListStore | undefined, config: BotConfig, args: readonly string[], context: BotEventContext<"messageCreate">) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => context.reply({ content: withPrefix(content, prefix), allowedMentions: noMentions })
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store) { yield* reply("Member list persistence is not configured"); return }
        const command = parseMemberListCommand(args)
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(memberListHelp); return }
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id)
        if (!manager) { yield* reply("Only the server owner or members with Manage Server can change the member list"); return }
        const order = memberListOrder(authority.roles, serverId)
        if (command.type === "list") {
            yield* reply(order.length ? ["Member list order, top first:", ...order.map((role, index) => `${index + 1}. <@&${role.id}>`)].join("\n")
                : "No role is shown separately in the member list. Turn on that role setting in Fluxer first")
            return
        }
        let change: Change = command.type === "reset" ? { type: "reset" } : { type: "set", roleIds: command.type === "set" ? command.roleIds : [] }
        if (command.type === "move") {
            const rest = order.map(role => role.id).filter(id => id !== command.roleId)
            if (rest.length === order.length) { yield* reply("That role is not shown separately in the member list. Check !memberlist"); return }
            rest.splice(Math.min(command.position, order.length) - 1, 0, command.roleId)
            change = { type: "set", roleIds: rest }
        }
        const changed = yield* applyMemberList(client, serverId, authority, change)
        if (!changed) { yield* reply("The member list already shows this order"); return }
        // The order is already live in Fluxer, so a failed record only leaves it out of the settings history
        const recorded = yield* sourceTimestamp(message).pipe(Effect.flatMap(createdAt => store.manage({ serverId, originServerId: serverId, messageId: message.id, createdAt, actor, managerAuthorized: true, operation: change })),
            Effect.as(true), Effect.catch(() => Effect.succeed(false)))
        yield* reply(`${change.type === "reset" ? "Member list order reset. It follows the role hierarchy again" : "Member list order updated"}${recorded ? "" : ". The change could not be added to the settings history"}`)
    }).pipe(Effect.catch(error => reply(describe(error))), Effect.asVoid)
}

/** A dashboard change is checked and applied natively before the backend records it */
export function prepareMemberListDashboardJob(client: Client, serverId: string, job: D.DashboardConfigurationReadyJob) {
    return Effect.gen(function* () {
        if (job.family !== "memberlist") return
        const { authority } = yield* readServerManager(client, serverId, job.actorId)
        yield* applyMemberList(client, serverId, authority, job.operation as C.MemberListOperation)
    })
}
