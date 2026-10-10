import { v } from "convex/values"
import { serviceMutation, serviceQuery } from "./installations.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { VoiceManageOperation, VoiceManageRequest, VoiceQueryRequest, VoiceRoomsRequest, type VoiceGenerator, type VoiceManageResult, type VoiceQueryResult, type VoiceRoom, type VoiceRoomsResult } from "@neonflux/contracts/voice"
import type { ConfigurationIdentity } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { actor } from "./moderationDomain.ts"
import { config, readSettings } from "./moderationStore.ts"
import { decode, fail, requireServer, source } from "./validation.ts"
import { VOICE_GENERATOR_LIMIT, VOICE_ROOM_LIMIT, voicePatch, voiceStaff } from "./voiceDomain.ts"

type Read = QueryCtx | MutationCtx
export const publicVoiceGenerator = (row: Doc<"voiceGenerators">): VoiceGenerator => ({ channelId: row.channelId, categoryId: row.categoryId, template: row.template,
    userLimit: row.userLimit, region: row.region, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt })
export const publicVoiceRoom = (row: Doc<"voiceRooms">): VoiceRoom => ({ channelId: row.channelId, ownerId: row.ownerId, generatorChannelId: row.generatorChannelId, createdAt: row.createdAt })
export const readVoiceGenerators = (ctx: Read, serverId: string) => ctx.db.query("voiceGenerators").withIndex("by_channel", q => q.eq("serverId", serverId)).take(VOICE_GENERATOR_LIMIT)
export const readVoiceRooms = (ctx: Read, serverId: string) => ctx.db.query("voiceRooms").withIndex("by_channel", q => q.eq("serverId", serverId)).take(VOICE_ROOM_LIMIT)
const generatorRow = (ctx: Read, serverId: string, channelId: string) => ctx.db.query("voiceGenerators").withIndex("by_channel", q => q.eq("serverId", serverId).eq("channelId", channelId)).unique()
const roomRow = (ctx: Read, serverId: string, channelId: string) => ctx.db.query("voiceRooms").withIndex("by_channel", q => q.eq("serverId", serverId).eq("channelId", channelId)).unique()
const ownedRoom = (ctx: Read, serverId: string, ownerId: string) => ctx.db.query("voiceRooms").withIndex("by_owner", q => q.eq("serverId", serverId).eq("ownerId", ownerId)).first()

export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<VoiceQueryResult> => {
    const { serverId, operation: op } = decode(VoiceQueryRequest, request); requireServer(serverId)
    const generators = (await readVoiceGenerators(ctx, serverId)).map(publicVoiceGenerator), rooms = (await readVoiceRooms(ctx, serverId)).map(publicVoiceRoom)
    if (op.type === "state") return { type: "state", generators, rooms }
    const who = actor(op.actor), room = op.channelId === undefined ? await ownedRoom(ctx, serverId, who.userId) : await roomRow(ctx, serverId, op.channelId)
    return { type: "authority", staff: voiceStaff(who, config(await readSettings(ctx, serverId))), room: room ? publicVoiceRoom(room) : null, generators, rooms: rooms.length }
} })

export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<VoiceManageResult> => {
    const input = decode(VoiceManageRequest, request), identity = source(input, Date.now()), who = actor(input.actor), operation = input.operation
    if (!voiceStaff(who, config(await readSettings(ctx, identity.serverId)))) fail(403, "Voice generator staff permission required")
    return changeConfiguration(ctx, identity.serverId, "voice", { kind: "chat", createdAt: identity.createdAt, actor: { userId: who.userId, source: "command" }, operation },
        () => applyVoiceManagement(ctx, { serverId: identity.serverId, actorId: who.userId, createdAt: identity.createdAt, source: { kind: "chat", messageId: identity.messageId } }, operation))
} })

// Chat and dashboard share these rules. Channel names are applied natively by the bot and are validated, never stored
export async function applyVoiceManagement(ctx: MutationCtx, identity: ConfigurationIdentity, value: unknown): Promise<VoiceManageResult> {
    const serverId = identity.serverId, now = Date.now(), op = decode(VoiceManageOperation, value)
    if (op.type === "generator-add") {
        const channelId = op.channelId, fields = { categoryId: op.categoryId, template: op.template.trim(), userLimit: op.userLimit, region: op.region }
        if (await generatorRow(ctx, serverId, channelId) || await roomRow(ctx, serverId, channelId)) fail(409, "This channel is already a generator or a temporary room")
        if ((await readVoiceGenerators(ctx, serverId)).length >= VOICE_GENERATOR_LIMIT) fail(429, `A server can have at most ${VOICE_GENERATOR_LIMIT} generators`)
        const id = await ctx.db.insert("voiceGenerators", { serverId, channelId, ...fields, revision: 1, createdAt: now, updatedAt: now })
        return { type: "generator", generator: publicVoiceGenerator((await ctx.db.get(id))!) }
    }
    const row = await generatorRow(ctx, serverId, op.channelId)
    if (!row) fail(404, "This channel is not a generator")
    if (op.expectedRevision !== undefined && op.expectedRevision !== row.revision) fail(409, "Generator settings changed")
    if (op.type === "generator-remove") { await ctx.db.delete(row._id); return { type: "removed", channelId: row.channelId } }
    const { channelName: _name, ...patch } = voicePatch(op.patch)
    if (row.revision >= Number.MAX_SAFE_INTEGER) fail(429, "Generator revision exhausted")
    await ctx.db.patch(row._id, { ...patch, revision: row.revision + 1, updatedAt: now })
    return { type: "generator", generator: publicVoiceGenerator((await ctx.db.get(row._id))!) }
}

// Bot automation records rooms it created and forgets channels that were deleted. Idle servers never call this
export const rooms = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<VoiceRoomsResult> => {
    const { serverId, operation: op } = decode(VoiceRoomsRequest, request), channelId = op.channelId; requireServer(serverId)
    if (op.type === "forget") {
        const room = await roomRow(ctx, serverId, channelId), generator = await generatorRow(ctx, serverId, channelId)
        if (room) await ctx.db.delete(room._id)
        if (generator) await ctx.db.delete(generator._id)
        return { type: "forgotten", room: !!room, generator: !!generator }
    }
    return recordVoiceRoom(ctx, serverId, channelId, op.ownerId, op.generatorChannelId)
} })

// Generator rooms and group rooms share these rules: A recorded generator, one room per owner and the server's room limit
export async function recordVoiceRoom(ctx: MutationCtx, serverId: string, channelId: string, ownerId: string, generatorChannelId: string): Promise<Extract<VoiceRoomsResult, { type: "created" | "refused" }>> {
    if (!await generatorRow(ctx, serverId, generatorChannelId)) return { type: "refused", reason: "generator" }
    const existing = await ownedRoom(ctx, serverId, ownerId)
    if (existing) return { type: "refused", reason: "owner", room: publicVoiceRoom(existing) }
    if (await roomRow(ctx, serverId, channelId) || await generatorRow(ctx, serverId, channelId)) fail(409, "Channel already recorded")
    if ((await readVoiceRooms(ctx, serverId)).length >= VOICE_ROOM_LIMIT) return { type: "refused", reason: "room-limit" }
    const id = await ctx.db.insert("voiceRooms", { serverId, channelId, ownerId, generatorChannelId, createdAt: Date.now() })
    return { type: "created", room: publicVoiceRoom((await ctx.db.get(id))!) }
}
export const voiceGenerator = async (ctx: Read, serverId: string, channelId: string) => { const row = await generatorRow(ctx, serverId, channelId); return row ? publicVoiceGenerator(row) : null }
