import type { MemberAccessLists, MemberAccessOperation } from "../contracts.js"
import type { DashboardMemberFeature } from "../dashboard-contracts.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { shape } from "./publishingDomain.ts"
import { fail, ids, requireId } from "./validation.ts"

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
// The access list operations of member features other than the role picker. The website sends access-set, and chat commands add and remove entries
export function memberAccessOperation(input: Record<string, unknown>, dashboard: boolean): MemberAccessOperation {
    if (input.type === "access-set") {
        shape(input, ["type", ...memberAccessKeys], ["type", ...memberAccessKeys])
        return { type: "access-set", ...accessListShape(input) }
    }
    if (dashboard || input.type !== "access-add" && input.type !== "access-remove") fail(400, "Unsupported access operation")
    shape(input, ["type", "list", "kind", "ids"], ["type", "list", "kind", "ids"])
    if (input.list !== "allow" && input.list !== "block") fail(400, "Choose the allow or block list")
    if (input.kind !== "role" && input.kind !== "user") fail(400, "Choose role or user")
    if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > MEMBER_ACCESS_LIMIT) fail(400, `Name 1 to ${MEMBER_ACCESS_LIMIT} roles or users`)
    return { type: input.type, list: input.list, kind: input.kind, ids: [...new Set(input.ids.map(requireId))] }
}
function accessListShape(input: Record<string, unknown>): MemberAccessLists {
    for (const key of memberAccessKeys) if (!Array.isArray(input[key]) || input[key].length > MEMBER_ACCESS_LIMIT) fail(400, `Each access list holds at most ${MEMBER_ACCESS_LIMIT} entries`)
    const list = (key: typeof memberAccessKeys[number]) => [...new Set((input[key] as unknown[]).map(requireId))]
    return { allowRoleIds: list("allowRoleIds"), blockRoleIds: list("blockRoleIds"), allowUserIds: list("allowUserIds"), blockUserIds: list("blockUserIds") }
}
export async function applyMemberAccess(ctx: MutationCtx, serverId: string, feature: string, op: MemberAccessOperation) {
    let lists: MemberAccessLists
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
