import { MemberAccessLists } from "@neonflux/contracts/shared"
import { MemberAccessOperation } from "@neonflux/contracts/member-content"
import { MEMBER_ACCESS_LIMIT } from "@neonflux/contracts/role-picker"
import type { DashboardMemberFeature } from "../dashboard-contracts.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Types } from "effect"
import { decode, fail } from "./validation.ts"

// Shared member access lists, one row per server and feature name. Later member features reuse them under their own feature name
export const memberAccessKeys = ["allowRoleIds", "blockRoleIds", "allowUserIds", "blockUserIds"] as const
type Read = Pick<QueryCtx, "db">
type Lists = Types.Mutable<MemberAccessLists>
export const emptyAccess = (): Lists => ({ allowRoleIds: [], blockRoleIds: [], allowUserIds: [], blockUserIds: [] })
const unique = (ids: readonly string[]) => [...new Set(ids)]

export function accessLists(value: unknown, serverId: string): MemberAccessLists {
    const input = decode(MemberAccessLists, value, `Each access list holds at most ${MEMBER_ACCESS_LIMIT} entries`), lists = emptyAccess()
    for (const key of memberAccessKeys) lists[key] = unique(input[key])
    // The everyone role would make a list match every member, which an empty allow list already expresses
    if ([...lists.allowRoleIds, ...lists.blockRoleIds].includes(serverId)) fail(400, "Leave the allow list empty for everyone instead of using the everyone role")
    return lists
}
export async function readAccess(ctx: Read, serverId: string, feature: string): Promise<Lists> {
    const row = await ctx.db.query("memberAccessLists").withIndex("by_feature", q => q.eq("serverId", serverId).eq("feature", feature)).unique()
    return row ? { allowRoleIds: row.allowRoleIds, blockRoleIds: row.blockRoleIds, allowUserIds: row.allowUserIds, blockUserIds: row.blockUserIds } : emptyAccess()
}
export async function writeAccess(ctx: MutationCtx, serverId: string, feature: string, lists: MemberAccessLists) {
    const row = await ctx.db.query("memberAccessLists").withIndex("by_feature", q => q.eq("serverId", serverId).eq("feature", feature)).unique()
    if (row) await ctx.db.patch(row._id, lists)
    else await ctx.db.insert("memberAccessLists", { serverId, feature, ...lists })
}
// A block always wins. An empty allow list admits every member who is not blocked
export function accessAllowed(lists: MemberAccessLists, member: { userId: string, roleIds: readonly string[] }) {
    if (lists.blockUserIds.includes(member.userId) || member.roleIds.some(id => lists.blockRoleIds.includes(id))) return false
    if (!lists.allowUserIds.length && !lists.allowRoleIds.length) return true
    return lists.allowUserIds.includes(member.userId) || member.roleIds.some(id => lists.allowRoleIds.includes(id))
}
export async function memberAllowed(ctx: Read, serverId: string, feature: string, member: { userId: string, roleIds: readonly string[] }) {
    return accessAllowed(await readAccess(ctx, serverId, feature), member)
}
// The access list operations of member features, without repeated IDs. The website sends access-set, and chat commands add and remove entries
export function memberAccessOperation(input: Record<string, unknown>, dashboard: boolean): MemberAccessOperation {
    if (dashboard && input.type !== "access-set") fail(400, "Unsupported access operation")
    const op = decode(MemberAccessOperation, input)
    return op.type === "access-set" ? { type: op.type, allowRoleIds: unique(op.allowRoleIds), blockRoleIds: unique(op.blockRoleIds), allowUserIds: unique(op.allowUserIds), blockUserIds: unique(op.blockUserIds) }
        : { ...op, ids: unique(op.ids) }
}
export async function applyMemberAccess(ctx: MutationCtx, serverId: string, feature: string, op: MemberAccessOperation) {
    let lists: Lists
    if (op.type === "access-set") lists = { allowRoleIds: op.allowRoleIds, blockRoleIds: op.blockRoleIds, allowUserIds: op.allowUserIds, blockUserIds: op.blockUserIds }
    else {
        lists = await readAccess(ctx, serverId, feature)
        const key: keyof MemberAccessLists = `${op.list}${op.kind === "role" ? "RoleIds" : "UserIds"}`
        lists[key] = op.type === "access-add" ? [...new Set([...lists[key], ...op.ids])] : lists[key].filter(id => !op.ids.includes(id))
    }
    await writeAccess(ctx, serverId, feature, accessLists(lists, serverId))
}
export async function rolePickerEnabled(ctx: Read, serverId: string) {
    return (await ctx.db.query("rolePickerSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique())?.enabled === true
}
const switchedOn = async (ctx: Read, table: "showcaseSettings" | "profileSettings", serverId: string) =>
    (await ctx.db.query(table).withIndex("by_server", q => q.eq("serverId", serverId)).unique())?.enabled === true
/** The role whose members may view private cases on the website, or null while only the server owner may */
export async function privateDataRole(ctx: Read, serverId: string) {
    return (await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique())?.privateDataRoleId ?? null
}
// The member features a server offers on the website
export async function memberFeatures(ctx: Read, serverId: string): Promise<DashboardMemberFeature[]> {
    return [...await rolePickerEnabled(ctx, serverId) ? ["rolepicker" as const] : [], ...await switchedOn(ctx, "showcaseSettings", serverId) ? ["showcase" as const] : [],
        ...await switchedOn(ctx, "profileSettings", serverId) ? ["profile" as const] : [], ...await privateDataRole(ctx, serverId) !== null ? ["private" as const] : []]
}
