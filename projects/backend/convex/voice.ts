import { v } from "convex/values"
import { internalMutation, mutation, query as publicQuery } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import { jailHolds } from "./jailStore.ts"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import {
    VoiceManageOperation,
    VoiceManageRequest,
    VoiceMemberFinishRequest,
    VoiceMemberOperation,
    VoiceMemberReadyRequest,
    VoiceMemberStartRequest,
    VoiceQueryRequest,
    VoiceRoomsRequest,
    type VoiceGenerator,
    type VoiceManageResult,
    type VoiceMemberFinishResult,
    type VoiceMemberReadyResult,
    type VoiceMemberStartResult,
    type VoiceQueryResult,
    type VoiceRoom,
    type VoiceRoomsResult,
} from "@neonflux/contracts/voice"
import type { DashboardMemberQueueResult, DashboardVoiceMember } from "../dashboard-contracts.js"
import { changeConfiguration } from "./configurationChange.ts"
import { memberSession } from "./dashboard.ts"
import {
    expiredMemberRequest,
    finishMemberRequest,
    memberRequestJob,
    publicMemberJob,
    queueMemberRequest,
    readyMemberRequests,
    recentMemberRequests,
} from "./memberContent.ts"
import { actor, gateFor } from "./moderationDomain.ts"
import { config, readSettings } from "./moderationStore.ts"
import { blockingContentRule } from "./protection.ts"
import { memberGrant } from "./rolePickerStore.ts"
import { decode, fail, source, type ConfigurationIdentity } from "./validation.ts"
import { VOICE_FAMILY, VOICE_GENERATOR_LIMIT, VOICE_ROOM_LIMIT, voicePatch, voiceStaff } from "./voiceDomain.ts"

type Read = QueryCtx | MutationCtx
export const publicVoiceGenerator = (row: Doc<"voiceGenerators">): VoiceGenerator => ({
    channelId: row.channelId,
    categoryId: row.categoryId,
    template: row.template,
    userLimit: row.userLimit,
    region: row.region,
    ...(row.panel === false ? { panel: false } : {}),
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
})
/** The card is on unless a generator turned it off, so only that is stored */
const panelField = (value: boolean | undefined) => (value === false ? false : undefined)
export const publicVoiceRoom = (row: Doc<"voiceRooms">): VoiceRoom => ({
    channelId: row.channelId,
    ownerId: row.ownerId,
    generatorChannelId: row.generatorChannelId,
    createdAt: row.createdAt,
    ...(row.panelMessageId ? { panelMessageId: row.panelMessageId } : {}),
    ...(row.view ? { view: row.view } : {}),
    ...(row.heldAllow ? { heldAllow: row.heldAllow } : {}),
    ...(row.lockGrants ? { lockGrants: row.lockGrants } : {}),
})
export const readVoiceGenerators = (ctx: Read, serverId: string) =>
    ctx.db
        .query("voiceGenerators")
        .withIndex("by_channel", (q) => q.eq("serverId", serverId))
        .take(VOICE_GENERATOR_LIMIT)
export const readVoiceRooms = (ctx: Read, serverId: string) =>
    ctx.db
        .query("voiceRooms")
        .withIndex("by_channel", (q) => q.eq("serverId", serverId))
        .take(VOICE_ROOM_LIMIT)
const generatorRow = (ctx: Read, serverId: string, channelId: string) =>
    ctx.db
        .query("voiceGenerators")
        .withIndex("by_channel", (q) => q.eq("serverId", serverId).eq("channelId", channelId))
        .unique()
const roomRow = (ctx: Read, serverId: string, channelId: string) =>
    ctx.db
        .query("voiceRooms")
        .withIndex("by_channel", (q) => q.eq("serverId", serverId).eq("channelId", channelId))
        .unique()
const ownedRoom = (ctx: Read, serverId: string, ownerId: string) =>
    ctx.db
        .query("voiceRooms")
        .withIndex("by_owner", (q) => q.eq("serverId", serverId).eq("ownerId", ownerId))
        .first()

export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<VoiceQueryResult> => {
        const { serverId, operation: op } = decode(VoiceQueryRequest, request)
        const generators = (await readVoiceGenerators(ctx, serverId)).map(publicVoiceGenerator),
            rooms = (await readVoiceRooms(ctx, serverId)).map(publicVoiceRoom)
        if (op.type === "state") return { type: "state", generators, rooms }
        const who = actor(op.actor),
            settings = config(await readSettings(ctx, serverId)),
            room =
                op.channelId === undefined
                    ? await ownedRoom(ctx, serverId, who.userId)
                    : await roomRow(ctx, serverId, op.channelId)
        return {
            type: "authority",
            staff: voiceStaff(who, settings),
            room: room ? publicVoiceRoom(room) : null,
            generators,
            rooms: rooms.length,
            ...(gateFor(settings, op.actor, "public").allowed ? {} : { paused: true as const }),
        }
    },
})

export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<VoiceManageResult> => {
        const input = decode(VoiceManageRequest, request),
            identity = source(input, Date.now()),
            who = actor(input.actor),
            operation = input.operation
        if (!voiceStaff(who, config(await readSettings(ctx, identity.serverId))))
            fail(403, "Voice generator staff permission required")
        return changeConfiguration(
            ctx,
            identity.serverId,
            "voice",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: who.userId, source: "command" },
                operation,
            },
            () =>
                applyVoiceManagement(
                    ctx,
                    {
                        serverId: identity.serverId,
                        actorId: who.userId,
                        createdAt: identity.createdAt,
                        source: { kind: "chat", messageId: identity.messageId },
                    },
                    operation,
                ),
        )
    },
})

/**
 * Makes a channel a generator with these settings, or sets them on the generator it is. A backup restore uses it for a voice channel that
 * exists already, so it carries no channel name
 */
export async function saveVoiceGenerator(
    ctx: MutationCtx,
    serverId: string,
    channelId: string,
    value: Pick<VoiceGenerator, "categoryId" | "template" | "userLimit" | "region" | "panel">,
    now: number,
): Promise<VoiceManageResult> {
    const fields = {
            categoryId: value.categoryId,
            template: value.template.trim(),
            userLimit: value.userLimit,
            region: value.region,
        },
        row = await generatorRow(ctx, serverId, channelId)
    if (row) {
        if (row.revision >= Number.MAX_SAFE_INTEGER) fail(429, "Generator revision exhausted")
        await ctx.db.patch(row._id, {
            ...fields,
            panel: panelField(value.panel),
            revision: row.revision + 1,
            updatedAt: now,
        })
        return { type: "generator", generator: publicVoiceGenerator((await ctx.db.get(row._id))!) }
    }
    if (await roomRow(ctx, serverId, channelId)) fail(409, "This channel is a temporary room")
    if ((await readVoiceGenerators(ctx, serverId)).length >= VOICE_GENERATOR_LIMIT)
        fail(429, `A server can have at most ${VOICE_GENERATOR_LIMIT} generators`)
    const id = await ctx.db.insert("voiceGenerators", {
        serverId,
        channelId,
        ...fields,
        ...(value.panel === false ? { panel: false } : {}),
        revision: 1,
        createdAt: now,
        updatedAt: now,
    })
    return { type: "generator", generator: publicVoiceGenerator((await ctx.db.get(id))!) }
}
// Chat and dashboard share these rules. Channel names are applied natively by the bot and are validated, never stored
export async function applyVoiceManagement(
    ctx: MutationCtx,
    identity: ConfigurationIdentity,
    value: unknown,
): Promise<VoiceManageResult> {
    const serverId = identity.serverId,
        now = Date.now(),
        op = decode(VoiceManageOperation, value)
    if (op.type === "generator-add") {
        if ((await generatorRow(ctx, serverId, op.channelId)) || (await roomRow(ctx, serverId, op.channelId)))
            fail(409, "This channel is already a generator or a temporary room")
        return saveVoiceGenerator(ctx, serverId, op.channelId, op, now)
    }
    const row = await generatorRow(ctx, serverId, op.channelId)
    if (!row) fail(404, "This channel is not a generator")
    if (op.expectedRevision !== undefined && op.expectedRevision !== row.revision)
        fail(409, "Generator settings changed")
    if (op.type === "generator-remove") {
        await ctx.db.delete(row._id)
        return { type: "removed", channelId: row.channelId }
    }
    const { channelName: _name, panel, ...patch } = voicePatch(op.patch)
    if (row.revision >= Number.MAX_SAFE_INTEGER) fail(429, "Generator revision exhausted")
    await ctx.db.patch(row._id, {
        ...patch,
        ...(panel === undefined ? {} : { panel: panelField(panel) }),
        revision: row.revision + 1,
        updatedAt: now,
    })
    return { type: "generator", generator: publicVoiceGenerator((await ctx.db.get(row._id))!) }
}

// Bot automation records rooms it created and forgets channels that were deleted. Idle servers never call this
export const rooms = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<VoiceRoomsResult> => {
        const { serverId, operation: op } = decode(VoiceRoomsRequest, request),
            channelId = op.channelId
        if (op.type === "forget") {
            const room = await roomRow(ctx, serverId, channelId),
                generator = await generatorRow(ctx, serverId, channelId)
            if (room) await ctx.db.delete(room._id)
            if (generator) await ctx.db.delete(generator._id)
            return { type: "forgotten", room: !!room, generator: !!generator }
        }
        if (op.type === "transfer") {
            // The new owner must not own another room, so the one-room rule holds
            const room = await roomRow(ctx, serverId, channelId)
            if (!room || room.ownerId !== op.expectedOwnerId) return { type: "not-transferred", reason: "changed" }
            if (await ownedRoom(ctx, serverId, op.ownerId)) return { type: "not-transferred", reason: "owner" }
            await ctx.db.patch(room._id, { ownerId: op.ownerId })
            return { type: "transferred", room: publicVoiceRoom((await ctx.db.get(room._id))!) }
        }
        if (op.type === "update") {
            const room = await roomRow(ctx, serverId, channelId)
            if (!room) return { type: "updated", room: null }
            await ctx.db.patch(room._id, {
                ...(op.panelMessageId ? { panelMessageId: op.panelMessageId } : {}),
                ...(op.view ? { view: op.view } : {}),
                ...(op.heldAllow === undefined ? {} : { heldAllow: op.heldAllow === "0" ? undefined : op.heldAllow }),
                ...(op.lockGrants === undefined
                    ? {}
                    : { lockGrants: op.lockGrants.length ? [...op.lockGrants] : undefined }),
            })
            return { type: "updated", room: publicVoiceRoom((await ctx.db.get(room._id))!) }
        }
        return recordVoiceRoom(ctx, serverId, channelId, op.ownerId, op.generatorChannelId)
    },
})

// Generator rooms and group rooms share these rules: A recorded generator, one room per owner and the server's room limit
export async function recordVoiceRoom(
    ctx: MutationCtx,
    serverId: string,
    channelId: string,
    ownerId: string,
    generatorChannelId: string,
): Promise<Extract<VoiceRoomsResult, { type: "created" | "refused" }>> {
    if (!(await generatorRow(ctx, serverId, generatorChannelId))) return { type: "refused", reason: "generator" }
    const existing = await ownedRoom(ctx, serverId, ownerId)
    if (existing) return { type: "refused", reason: "owner", room: publicVoiceRoom(existing) }
    if ((await roomRow(ctx, serverId, channelId)) || (await generatorRow(ctx, serverId, channelId)))
        fail(409, "Channel already recorded")
    if ((await readVoiceRooms(ctx, serverId)).length >= VOICE_ROOM_LIMIT)
        return { type: "refused", reason: "room-limit" }
    const id = await ctx.db.insert("voiceRooms", {
        serverId,
        channelId,
        ownerId,
        generatorChannelId,
        createdAt: Date.now(),
    })
    return { type: "created", room: publicVoiceRoom((await ctx.db.get(id))!) }
}
export const voiceGenerator = async (ctx: Read, serverId: string, channelId: string) => {
    const row = await generatorRow(ctx, serverId, channelId)
    return row ? publicVoiceGenerator(row) : null
}

const uncertainRoomRequest =
    "The bot may have applied this but could not confirm it. Check your room before trying again"
// Website requests of a room owner. The website decides nothing: The bot reads the member and the room fresh and applies the same rule as the chat commands
export const request = mutation({
    args: { sessionToken: v.string(), serverId: v.string(), requestId: v.string(), operation: v.any() },
    handler: async (ctx, input): Promise<DashboardMemberQueueResult> => {
        const session = await memberSession(ctx, input.sessionToken, input.serverId, "voice")
        return queueMemberRequest(
            ctx,
            session,
            {
                serverId: input.serverId,
                requestId: input.requestId,
                family: VOICE_FAMILY,
                operation: decode(VoiceMemberOperation, input.operation),
            },
            internal.voice.expireRequest,
        )
    },
})
export const member = publicQuery({
    args: { sessionToken: v.string(), serverId: v.string() },
    handler: async (ctx, { sessionToken, serverId }): Promise<DashboardVoiceMember> => {
        const session = await memberSession(ctx, sessionToken, serverId, "voice"),
            room = await ownedRoom(ctx, serverId, session.userId)
        return {
            serverId,
            rooms: room ? [publicVoiceRoom(room)] : [],
            requests: (await recentMemberRequests(ctx, serverId, VOICE_FAMILY, session.userId)).map(
                publicMemberJob<VoiceMemberOperation>,
            ),
        }
    },
})
export const expireRequest = internalMutation({
    args: { id: v.id("dashboardConfigurationJobs") },
    handler: async (ctx, { id }) => {
        const job = await ctx.db.get(id)
        if (job?.family === VOICE_FAMILY && job.state === "queued")
            await finishMemberRequest(
                ctx,
                job,
                job.claimedAt === undefined ? expiredMemberRequest : uncertainRoomRequest,
            )
    },
})
// Only requests whose sign-in still holds reach the bot, so nothing changes in Fluxer for a member who signed out
export const memberReady = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<VoiceMemberReadyResult> => {
        const { serverId } = decode(VoiceMemberReadyRequest, request),
            jobs = []
        for (const job of await readyMemberRequests(ctx, serverId, VOICE_FAMILY))
            if (await memberGrant(ctx, job)) jobs.push(publicMemberJob<VoiceMemberOperation>(job))
        return { jobs }
    },
})
// Claims a request once, so a report that fails never makes the bot repeat a native change. A new room name faces the server's automod
// rules first, as a name typed in chat does, with the member's fresh roles. It shows across the server, so a rule's channel list does not narrow it
export const memberStart = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<VoiceMemberStartResult> => {
        const input = decode(VoiceMemberStartRequest, request),
            job = await memberRequestJob(ctx, input.serverId, VOICE_FAMILY, input.jobId, input.actorId)
        if (job.state !== "queued" || job.claimedAt !== undefined) return { started: false }
        const refuse = async (error: string) => {
            await finishMemberRequest(ctx, job, error)
            return { started: false }
        }
        if (!(await memberGrant(ctx, job)))
            return refuse("Your sign-in expired before the bot could act. Sign in again and retry")
        if (await jailHolds(ctx, input.serverId, job.actorId))
            return refuse("You cannot control a room while you are jailed")
        const operation = job.operation as VoiceMemberOperation
        if (operation.type === "rename") {
            const rule = await blockingContentRule(ctx, input.serverId, operation.name, input.roleIds)
            if (rule) return refuse(`The server's automod rule ${rule} blocked this room name. Choose another name`)
        }
        await ctx.db.patch(job._id, { claimedAt: Date.now() })
        return { started: true }
    },
})
export const memberFinish = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<VoiceMemberFinishResult> => {
        const input = decode(VoiceMemberFinishRequest, request),
            job = await memberRequestJob(ctx, input.serverId, VOICE_FAMILY, input.jobId)
        if (job.state === "queued") await finishMemberRequest(ctx, job, input.error)
        return { job: publicMemberJob<VoiceMemberOperation>((await ctx.db.get(job._id))!) }
    },
})
