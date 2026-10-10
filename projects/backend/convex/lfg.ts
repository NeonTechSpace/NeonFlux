import { v } from "convex/values"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import type { LfgGroup, LfgManageResult, LfgQueryResult, LfgSettings, LfgSettingsPatch, LfgWorkResult } from "../contracts.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { configurationRevision } from "./configurationRevision.ts"
import { actor } from "./moderationDomain.ts"
import { shape } from "./publishingDomain.ts"
import { fail, integer, requireId, requireServer, source } from "./validation.ts"
import { readVoiceGenerators, recordVoiceRoom, voiceGenerator } from "./voice.ts"
import { LFG_DEFAULTS, LFG_LIMITS, LFG_WORK_PAGE, lfgOperation } from "./lfgDomain.ts"

type Read = QueryCtx | MutationCtx
const settingsRow = (ctx: Read, serverId: string) => ctx.db.query("lfgSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export async function readLfgSettings(ctx: Read, serverId: string): Promise<LfgSettings> {
    const row = await settingsRow(ctx, serverId)
    if (!row) return { ...LFG_DEFAULTS }
    const { enabled, channelId, generatorChannelId, expiryMinutes, maxSize, memberGroups, serverGroups } = row
    return { enabled, channelId, generatorChannelId, expiryMinutes, maxSize, memberGroups, serverGroups }
}
const groupRow = (ctx: Read, serverId: string, groupNo: number) => ctx.db.query("lfgGroups").withIndex("by_number", q => q.eq("serverId", serverId).eq("groupNo", groupNo)).unique()
const memberRows = (ctx: Read, serverId: string, groupNo: number) => ctx.db.query("lfgMembers").withIndex("by_group", q => q.eq("serverId", serverId).eq("groupNo", groupNo)).take(LFG_LIMITS.maxSize[1])
/** A server's groups, including those whose time ran out and that the worker closes next */
export const readOpenGroups = (ctx: Read, serverId: string) => ctx.db.query("lfgGroups").withIndex("by_server_expiry", q => q.eq("serverId", serverId)).take(LFG_LIMITS.serverGroups[1])
function publicGroup(row: Doc<"lfgGroups">, members: Doc<"lfgMembers">[]): LfgGroup {
    return { groupNo: row.groupNo, hostId: row.hostId, activity: row.activity, size: row.size, ...(row.note !== undefined ? { note: row.note } : {}), ...(row.startsAt !== undefined ? { startsAt: row.startsAt } : {}),
        channelId: row.channelId, messageId: row.messageId, memberIds: [row.hostId, ...[...members].sort((a, b) => a.joinedAt - b.joinedAt).map(member => member.userId)], expiresAt: row.expiresAt, createdAt: row.createdAt }
}
const readGroup = async (ctx: Read, row: Doc<"lfgGroups">) => publicGroup(row, await memberRows(ctx, row.serverId, row.groupNo))
// A group that starts, is cancelled or expires leaves no rows behind
async function closeGroup(ctx: MutationCtx, row: Doc<"lfgGroups">) {
    const members = await memberRows(ctx, row.serverId, row.groupNo), group = publicGroup(row, members)
    for (const member of members) await ctx.db.delete(member._id)
    await ctx.db.delete(row._id)
    return group
}

// Chat and dashboard share these rules. A chosen generator must exist when it is saved, and the room creation checks it again
export async function applyLfgSettings(ctx: MutationCtx, serverId: string, patch: LfgSettingsPatch): Promise<LfgSettings> {
    if (patch.generatorChannelId && !await voiceGenerator(ctx, serverId, patch.generatorChannelId)) fail(404, "That channel is not a voice generator")
    const row = await settingsRow(ctx, serverId), next = { ...await readLfgSettings(ctx, serverId), ...patch }
    if (row) await ctx.db.patch(row._id, next)
    else await ctx.db.insert("lfgSettings", { serverId, ...next, nextGroupNo: 1 })
    return next
}

export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<LfgQueryResult> => {
    const input = shape(request, ["serverId", "operation"], ["serverId", "operation"]), serverId = requireId(input.serverId); requireServer(serverId)
    const op = shape(input.operation, ["type", "groupNo"], ["type"]), now = Date.now(), settings = await readLfgSettings(ctx, serverId)
    if (op.type === "list") {
        shape(op, ["type"], ["type"])
        const groups = await Promise.all((await readOpenGroups(ctx, serverId)).filter(row => row.expiresAt > now).map(row => readGroup(ctx, row)))
        return { type: "groups", revision: await configurationRevision(ctx, serverId, "lfg"), settings, groups }
    }
    if (op.type !== "start") fail(400, "Unknown looking for group query")
    const row = await groupRow(ctx, serverId, integer(op.groupNo, 1, Number.MAX_SAFE_INTEGER))
    return { type: "start", group: row && row.expiresAt > now ? await readGroup(ctx, row) : null, generator: settings.generatorChannelId ? await voiceGenerator(ctx, serverId, settings.generatorChannelId) : null }
} })

export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<LfgManageResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "managerAuthorized", "operation"], ["serverId", "messageId", "createdAt", "actor", "managerAuthorized", "operation"])
    const identity = source(input, Date.now()), serverId = identity.serverId, who = actor(input.actor), op = lfgOperation(input.operation), now = Date.now()
    // The server owner, Administrators and members with Manage Server, which the bot reads fresh
    const manager = input.managerAuthorized === true && who.nativePermissionAuthorized
    if (op.type === "settings") {
        if (!manager) fail(403, "Manage Server permission required")
        const settings = await changeConfiguration(ctx, serverId, "lfg", { kind: "chat", createdAt: identity.createdAt, actor: { userId: who.userId, source: "command" }, operation: op },
            () => applyLfgSettings(ctx, serverId, op.patch))
        return { type: "settings", revision: await configurationRevision(ctx, serverId, "lfg"), settings }
    }
    const settings = await readLfgSettings(ctx, serverId)
    if (op.type === "create") {
        if (!settings.enabled || !settings.channelId) return { type: "refused", reason: "off" }
        if (op.size > settings.maxSize) return { type: "refused", reason: "size", limit: settings.maxSize }
        const hosted = await ctx.db.query("lfgGroups").withIndex("by_member_data", q => q.eq("hostId", who.userId).eq("serverId", serverId)).take(LFG_LIMITS.memberGroups[1])
        if (hosted.length >= settings.memberGroups) return { type: "refused", reason: "member-limit", limit: settings.memberGroups }
        if ((await readOpenGroups(ctx, serverId)).length >= settings.serverGroups) return { type: "refused", reason: "server-limit", limit: settings.serverGroups }
        // Saving a setting created the row, and the feature is on only after one
        const row = (await settingsRow(ctx, serverId))!, startsAt = op.startsInMinutes === undefined ? undefined : now + op.startsInMinutes * 60000
        const id = await ctx.db.insert("lfgGroups", { serverId, groupNo: row.nextGroupNo, hostId: who.userId, activity: op.activity, size: op.size, ...(op.note !== undefined ? { note: op.note } : {}),
            ...(startsAt !== undefined ? { startsAt } : {}), channelId: settings.channelId, messageId: null, expiresAt: (startsAt ?? now) + settings.expiryMinutes * 60000, createdAt: now })
        await ctx.db.patch(row._id, { nextGroupNo: row.nextGroupNo + 1 })
        return { type: "group", group: publicGroup((await ctx.db.get(id))!, []) }
    }
    const row = await groupRow(ctx, serverId, op.groupNo)
    if (!row || row.expiresAt <= now) return { type: "refused", reason: "missing" }
    const members = await memberRows(ctx, serverId, row.groupNo), joined = members.find(member => member.userId === who.userId)
    const current = async () => ({ type: "group" as const, group: await readGroup(ctx, (await ctx.db.get(row._id))!) })
    if (op.type === "card") { await ctx.db.patch(row._id, { messageId: op.messageId }); return current() }
    if (op.type === "cancel") return row.hostId === who.userId || manager ? { type: "closed", group: await closeGroup(ctx, row) } : { type: "refused", reason: "permission" }
    if (op.type === "leave") {
        if (row.hostId === who.userId) return { type: "refused", reason: "host" }
        if (!joined) return { type: "refused", reason: "not-joined" }
        await ctx.db.delete(joined._id)
        return current()
    }
    // Joining and starting pause while the feature is off. Leaving, cancelling and expiry continue
    if (!settings.enabled) return { type: "refused", reason: "off" }
    if (op.type === "join") {
        if (row.hostId === who.userId || joined) return { type: "refused", reason: "joined" }
        if (members.length + 1 >= row.size) return { type: "refused", reason: "full" }
        await ctx.db.insert("lfgMembers", { serverId, groupNo: row.groupNo, userId: who.userId, joinedAt: now })
        return current()
    }
    // A full group starts for any member. Otherwise the host or a manager starts it early
    if (row.hostId !== who.userId && !manager && members.length + 1 < row.size) return { type: "refused", reason: "permission" }
    if (!settings.generatorChannelId) return { type: "refused", reason: "generator" }
    const room = await recordVoiceRoom(ctx, serverId, op.channelId, row.hostId, settings.generatorChannelId)
    if (room.type === "refused" && room.reason !== "owner") return { type: "refused", reason: room.reason }
    return { type: "started", group: await closeGroup(ctx, row), room: room.room!, created: room.type === "created" }
} })

// Closes groups whose time ran out, ten at a time, so the bot can mark their cards
export const work = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<LfgWorkResult> => {
    const input = shape(request, ["serverId"], ["serverId"]), serverId = requireId(input.serverId); requireServer(serverId)
    const rows = await ctx.db.query("lfgGroups").withIndex("by_server_expiry", q => q.eq("serverId", serverId).lte("expiresAt", Date.now())).take(LFG_WORK_PAGE)
    const groups: LfgGroup[] = []
    for (const row of rows) groups.push(await closeGroup(ctx, row))
    return { groups }
} })

/** The dashboard view: Settings, the generators a manager can choose and the number of open groups */
export async function lfgView(ctx: Read, serverId: string) {
    return { settings: await readLfgSettings(ctx, serverId), generators: (await readVoiceGenerators(ctx, serverId)).map(row => row.channelId), open: (await readOpenGroups(ctx, serverId)).length }
}
