import { v } from "convex/values"
import type { MetadataLogsManageResult, MetadataLogsQueryResult } from "../contracts.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { shape } from "./publishingDomain.ts"
import { metadataBinding, metadataCategory, metadataContext, metadataEvent, metadataIds, metadataNumber, METADATA_SETTLE_MS } from "./metadataLogsDomain.ts"
import { admitMetadata, applyMetadataConfiguration, metadataAdmin, metadataAuthority, metadataBoundRecord, metadataConfigurationCritical, metadataConfigurationOperation, metadataCounters, metadataDelivery, metadataReceipt, metadataRecord, metadataSettingsEvent, metadataState, publicMetadataRecord, publicMetadataSettings, readMetadataSettings, removeMetadataRecord } from "./metadataLogsStore.ts"
import { fail, requireId, requireServer, integer, source } from "./validation.ts"

export const admit = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId", "event"], ["serverId", "event"]), serverId = requireId(input.serverId); requireServer(serverId)
    return admitMetadata(ctx, serverId, metadataEvent(input.event))
} })

export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<MetadataLogsManageResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "context", "operation"], ["serverId", "messageId", "createdAt", "context", "operation"]), identity = source(input, Date.now()), context = metadataContext(input.context), op = shape(input.operation, ["type", "expectedRevision", "enabled", "category", "eventType", "channelId", "ownerId", "recipientOwner", "messageChannelIds", "excludedChannelIds", "recordNo", "confirm", "binding", "observation"])
    const configuration = !["forget", "reconcile"].includes(String(op.type))
    const { recipientOwner, ...configurationInput } = op
    const config = configuration ? metadataConfigurationOperation(configurationInput) : undefined
    await metadataAdmin(ctx, identity.serverId, context, config ? metadataConfigurationCritical(config) : true)
    if (!await metadataReceipt(ctx, identity, context.actor.userId, op)) return { duplicate: true }
    if (config) {
        if (recipientOwner !== undefined && config.type !== "route" && config.type !== "event-route") fail(400, "Unexpected metadata recipient")
        const result = await applyMetadataConfiguration(ctx, identity.serverId, { userId: context.actor.userId, source: "command" }, config, recipientOwner)
        await metadataSettingsEvent(ctx, identity, context.actor.userId, "metadata", result.changedFields, result.previouslyEnabled)
        return { duplicate: false, type: "settings", settings: publicMetadataSettings(await readMetadataSettings(ctx, identity.serverId)) }
    } else if (op.type === "forget") {
        shape(op, ["type", "recordNo", "confirm"], ["type", "recordNo", "confirm"])
        if (op.confirm !== true) fail(400, "Metadata forgetting requires confirmation")
        const row = await metadataRecord(ctx, identity.serverId, metadataNumber(op.recordNo)), d = row.delivery
        if (row.actionable || d && ((d.state === "uncertain" || d.state === "failed" && !d.noDispatch) && !d.resolution)) fail(409, "Unsettled metadata evidence cannot be forgotten")
        await removeMetadataRecord(ctx, row)
        return { duplicate: false, type: "forgotten", recordNo: row.recordNo }
    } else if (op.type === "reconcile") {
        shape(op, ["type", "binding", "observation"], ["type", "binding", "observation"])
        const binding = metadataBinding(op.binding), row = await metadataBoundRecord(ctx, identity.serverId, binding), d = row.delivery
        const o = shape(op.observation, ["messageId", "channelId", "botId", "observedAt", "status", "content", "embed"], ["messageId", "channelId", "botId", "observedAt", "status"])
        if (!d.messageId || !d.grant || !["sent", "failed", "uncertain"].includes(d.state) || Date.now() <= d.grant.dispatchExpiresAt + METADATA_SETTLE_MS) fail(409, "Known terminal metadata message required after dispatch window")
        if (context.channelId !== d.channelId || !context.member.canView || !context.member.canReadHistory || !context.botAuthorized || context.botId !== d.grant.botId) fail(403, "Current metadata message visibility required")
        if (requireId(o.messageId) !== d.messageId || requireId(o.channelId) !== d.channelId || requireId(o.botId) !== d.grant.botId) fail(409, "Metadata observation identity mismatch")
        const observedAt = integer(o.observedAt, Math.max(Date.now() - 60000, d.grant.dispatchExpiresAt + METADATA_SETTLE_MS + 1), Date.now() + 1000)
        if (!["match", "absent", "conflict", "unknown"].includes(String(o.status))) fail(400, "Invalid metadata observation")
        const sameEmbed = (a: unknown, b: unknown) => {
            if (a === undefined || b === undefined) return a === b
            const input = shape(a, ["title", "description", "color"], ["title", "description", "color"]), expected = b as { title: string, description: string, color: number }
            return input.title === expected.title && input.description === expected.description && input.color === expected.color
        }
        if (o.status === "match" && (o.content !== d.grant.content || !sameEmbed(o.embed, d.grant.embed)) || o.status !== "match" && (o.content !== undefined || o.embed !== undefined)) fail(409, "Metadata canonical observation mismatch")
        if (o.status === "unknown" || o.status === "conflict") return { duplicate: false, type: "reconciled", recorded: false, record: publicMetadataRecord(row) }
        if (d.resolution && d.resolution !== o.status) fail(409, "Metadata reconciliation already resolved")
        if (d.resolution) return { duplicate: false, type: "reconciled", recorded: false, record: publicMetadataRecord(row) }
        const record = await metadataDelivery(ctx, row, { ...d, resolution: o.status as "match" | "absent", reconciledAt: observedAt })
        return { duplicate: false, type: "reconciled", recorded: true, record }
    } else fail(400, "Unknown metadata management operation")
} })

function metadataPrivate(value: unknown, actorId: string, botId: string) {
    const p = shape(value, ["channelId", "recipientIds", "oneToOne"], ["channelId", "recipientIds", "oneToOne"])
    requireId(p.channelId)
    if (!Array.isArray(p.recipientIds) || p.recipientIds.length !== 2) fail(403, "Verified one-to-one private report required")
    const recipients = metadataIds(p.recipientIds, 2)
    if (p.oneToOne !== true || recipients.length !== 2 || !recipients.includes(actorId) || !recipients.includes(botId) || actorId === botId) fail(403, "Verified one-to-one private report required")
}
export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<MetadataLogsQueryResult> => {
    const input = shape(request, ["serverId", "context", "privateRead", "operation"], ["serverId", "context", "operation"]), serverId = requireId(input.serverId); requireServer(serverId)
    const op = shape(input.operation, ["type", "beforeRecordNo", "recordNo"]), context = metadataContext(input.context, true)
    await metadataAdmin(ctx, serverId, context, true)
    // Reports reach admins privately, bound to the reading admin, the bot and that DM
    if (context.channelType === 1 || op.type === "counters") {
        if (input.privateRead === undefined) fail(403, "Verified one-to-one private report required")
        metadataPrivate(input.privateRead, context.actor.userId, context.botId)
        if (context.channelType === 1 && (input.privateRead as { channelId: string }).channelId !== context.channelId) fail(403, "Private report channel mismatch")
    }
    if (op.type === "settings") { shape(op, ["type"], ["type"]); return { type: "settings", settings: publicMetadataSettings(await readMetadataSettings(ctx, serverId)) } }
    if (op.type === "show") { shape(op, ["type", "recordNo"], ["type", "recordNo"]); return { type: "record", record: publicMetadataRecord(await metadataRecord(ctx, serverId, metadataNumber(op.recordNo))) } }
    if (op.type === "list") {
        shape(op, ["type", "beforeRecordNo"], ["type"])
        // A page of 10 for !logs events list. The eleventh row only tells whether another page follows
        const before = op.beforeRecordNo === undefined ? Number.MAX_SAFE_INTEGER : metadataNumber(op.beforeRecordNo), rows = await ctx.db.query("metadataLogRecords").withIndex("by_number", q => q.eq("serverId", serverId).lt("recordNo", before)).order("desc").take(11), selected = rows.slice(0, 10)
        return { type: "records", records: selected.map(publicMetadataRecord), ...(rows.length > 10 ? { nextBeforeRecordNo: selected.at(-1)!.recordNo } : {}) }
    }
    if (op.type === "counters") { shape(op, ["type"], ["type"]); return { type: "counters", counters: await metadataCounters(ctx, serverId) } }
    fail(400, "Unknown metadata query")
} })
