import type { MemberAccessLists } from "../contracts.js"
import type { DashboardMemberFeature } from "../dashboard-contracts.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { shape } from "./publishingDomain.ts"
import { fail, ids } from "./validation.ts"

// Shared member access lists, one row per server and feature name. Later member features reuse them under their own feature name
export const MEMBER_ACCESS_LIMIT = 100
export const memberAccessKeys = ["allowRoleIds", "blockRoleIds", "allowUserIds", "blockUserIds"] as const
type Read = Pick<QueryCtx, "db">
export const emptyAccess = (): MemberAccessLists => ({ allowRoleIds: [], blockRoleIds: [], allowUserIds: [], blockUserIds: [] })

export function accessLists(value: unknown, serverId: string): MemberAccessLists {
    const input = shape(value, [...memberAccessKeys], [...memberAccessKeys])
    const lists = emptyAccess()
    for (const key of memberAccessKeys) {
        if (!Array.isArray(input[key]) || input[key].length > MEMBER_ACCESS_LIMIT) fail(400, `Each access list holds at most ${MEMBER_ACCESS_LIMIT} entries`)
        lists[key] = ids(input[key], MEMBER_ACCESS_LIMIT)
    }
    // The everyone role would make a list match every member, which an empty allow list already expresses
    if ([...lists.allowRoleIds, ...lists.blockRoleIds].includes(serverId)) fail(400, "Leave the allow list empty for everyone instead of using the everyone role")
    return lists
}
export async function readAccess(ctx: Read, serverId: string, feature: string): Promise<MemberAccessLists> {
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
export async function rolePickerEnabled(ctx: Read, serverId: string) {
    return (await ctx.db.query("rolePickerSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique())?.enabled === true
}
/** The role whose members may view private cases on the website, or null while only the server owner may */
export async function privateDataRole(ctx: Read, serverId: string) {
    return (await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique())?.privateDataRoleId ?? null
}
// The member features a server offers on the website
export async function memberFeatures(ctx: Read, serverId: string): Promise<DashboardMemberFeature[]> {
    return [...await rolePickerEnabled(ctx, serverId) ? ["rolepicker" as const] : [], ...await privateDataRole(ctx, serverId) !== null ? ["private" as const] : []]
}
