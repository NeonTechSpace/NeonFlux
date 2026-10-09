import { MemberAccessLists, type MemberAccessOperation } from "@neonflux/contracts/shared"
import { MEMBER_ACCESS_LIMIT } from "@neonflux/contracts/role-picker"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Types } from "effect"
import { decode, fail } from "./validation.ts"

// Member access lists, one row per server and feature name
const memberAccessKeys = ["allowRoleIds", "blockRoleIds", "allowUserIds", "blockUserIds"] as const
type Read = Pick<QueryCtx, "db">
type Lists = Types.Mutable<MemberAccessLists>
const emptyAccess = (): Lists => ({ allowRoleIds: [], blockRoleIds: [], allowUserIds: [], blockUserIds: [] })
const unique = (ids: readonly string[]) => [...new Set(ids)]

export function accessLists(value: unknown, serverId: string): MemberAccessLists {
    const input = decode(MemberAccessLists, value, `Each access list holds at most ${MEMBER_ACCESS_LIMIT} entries`),
        lists = emptyAccess()
    for (const key of memberAccessKeys) lists[key] = unique(input[key])
    // The everyone role would make a list match every member, which an empty allow list already expresses
    if ([...lists.allowRoleIds, ...lists.blockRoleIds].includes(serverId))
        fail(400, "Leave the allow list empty for everyone instead of using the everyone role")
    return lists
}
export async function readAccess(ctx: Read, serverId: string, feature: string): Promise<Lists> {
    const row = await ctx.db
        .query("memberAccessLists")
        .withIndex("by_feature", (q) => q.eq("serverId", serverId).eq("feature", feature))
        .unique()
    return row
        ? {
              allowRoleIds: row.allowRoleIds,
              blockRoleIds: row.blockRoleIds,
              allowUserIds: row.allowUserIds,
              blockUserIds: row.blockUserIds,
          }
        : emptyAccess()
}
export async function writeAccess(ctx: MutationCtx, serverId: string, feature: string, lists: MemberAccessLists) {
    const row = await ctx.db
        .query("memberAccessLists")
        .withIndex("by_feature", (q) => q.eq("serverId", serverId).eq("feature", feature))
        .unique()
    if (row) await ctx.db.patch(row._id, lists)
    else await ctx.db.insert("memberAccessLists", { serverId, feature, ...lists })
}
// A block always wins. An empty allow list admits every member who is not blocked
export function accessAllowed(lists: MemberAccessLists, member: { userId: string; roleIds: readonly string[] }) {
    if (lists.blockUserIds.includes(member.userId) || member.roleIds.some((id) => lists.blockRoleIds.includes(id)))
        return false
    if (!lists.allowUserIds.length && !lists.allowRoleIds.length) return true
    return lists.allowUserIds.includes(member.userId) || member.roleIds.some((id) => lists.allowRoleIds.includes(id))
}
export async function memberAllowed(
    ctx: Read,
    serverId: string,
    feature: string,
    member: { userId: string; roleIds: readonly string[] },
) {
    return accessAllowed(await readAccess(ctx, serverId, feature), member)
}
// Member access list operations, without repeated IDs. The website sends access-set, and chat commands add and remove entries
export function memberAccessOperation(op: MemberAccessOperation, dashboard: boolean): MemberAccessOperation {
    if (dashboard && op.type !== "access-set") fail(400, "Unsupported access operation")
    return op.type === "access-set"
        ? {
              type: op.type,
              allowRoleIds: unique(op.allowRoleIds),
              blockRoleIds: unique(op.blockRoleIds),
              allowUserIds: unique(op.allowUserIds),
              blockUserIds: unique(op.blockUserIds),
          }
        : { ...op, ids: unique(op.ids) }
}
export async function rolePickerEnabled(ctx: Read, serverId: string) {
    return (
        (
            await ctx.db
                .query("rolePickerSettings")
                .withIndex("by_server", (q) => q.eq("serverId", serverId))
                .unique()
        )?.enabled === true
    )
}
