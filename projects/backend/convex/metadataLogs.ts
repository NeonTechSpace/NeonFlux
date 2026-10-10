import { v } from "convex/values"
import { MetadataLogsAdmitRequest, MetadataLogsManageRequest, MetadataLogsQueryRequest, MetadataLogsPrivateRead, equalMetadataEmbed, type MetadataLogsManageResult, type MetadataLogsQueryResult, type MetadataLogsAdmitResult } from "@neonflux/contracts/metadata-logs"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { metadataBinding, metadataContext, metadataEvent, metadataIds, metadataNumber, METADATA_SETTLE_MS } from "./metadataLogsDomain.ts"
import { admitMetadata, applyMetadataConfiguration, metadataAdmin, metadataBoundRecord, metadataConfigurationCritical, metadataConfigurationOperation, metadataCounters, metadataDelivery, metadataReceipt, metadataRecord, metadataSettingsEvent, publicMetadataRecord, publicMetadataSettings, readMetadataSettings, removeMetadataRecord } from "./metadataLogsStore.ts"
import { decode, fail, requireId, requireServer, integer, source } from "./validation.ts"

export const admit = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<MetadataLogsAdmitResult> => {
    const input = decode(MetadataLogsAdmitRequest, request), serverId = input.serverId; requireServer(serverId)
    return admitMetadata(ctx, serverId, metadataEvent(input.event))
} })

export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<MetadataLogsManageResult> => {
    const input = decode(MetadataLogsManageRequest, request), identity = source(input, Date.now()), context = metadataContext(input.context), op = input.operation
    const configuration = !["forget", "reconcile"].includes(String(op.type))
    const { recipientOwner, ...configurationInput } = "recipientOwner" in op ? op : { ...op, recipientOwner: undefined }
    const config = configuration ? metadataConfigurationOperation(configurationInput) : undefined
    await metadataAdmin(ctx, identity.serverId, context, config ? metadataConfigurationCritical(config) : true)
    if (!await metadataReceipt(ctx, identity, context.actor.userId, op)) return { duplicate: true }
    if (config) {
        if (recipientOwner !== undefined && config.type !== "route" && config.type !== "event-route") fail(400, "Unexpected metadata recipient")
        const result = await applyMetadataConfiguration(ctx, identity.serverId, { userId: context.actor.userId, source: "command" }, config, recipientOwner)
        await metadataSettingsEvent(ctx, identity, context.actor.userId, "metadata", result.changedFields, result.previouslyEnabled)
        return { duplicate: false, type: "settings", settings: publicMetadataSettings(await readMetadataSettings(ctx, identity.serverId)) }
    } else if (op.type === "forget") {
        const row = await metadataRecord(ctx, identity.serverId, metadataNumber(op.recordNo)), d = row.delivery
        if (row.actionable || d && ((d.state === "uncertain" || d.state === "failed" && !d.noDispatch) && !d.resolution)) fail(409, "Unsettled metadata evidence cannot be forgotten")
        await removeMetadataRecord(ctx, row)
        return { duplicate: false, type: "forgotten", recordNo: row.recordNo }
    } else if (op.type === "reconcile") {
        const binding = metadataBinding(op.binding), row = await metadataBoundRecord(ctx, identity.serverId, binding), d = row.delivery
        const o = op.observation
        if (!d.messageId || !d.grant || !["sent", "failed", "uncertain"].includes(d.state) || Date.now() <= d.grant.dispatchExpiresAt + METADATA_SETTLE_MS) fail(409, "Known terminal metadata message required after dispatch window")
        if (context.channelId !== d.channelId || !context.member.canView || !context.member.canReadHistory || !context.botAuthorized || context.botId !== d.grant.botId) fail(403, "Current metadata message visibility required")
        if (requireId(o.messageId) !== d.messageId || requireId(o.channelId) !== d.channelId || requireId(o.botId) !== d.grant.botId) fail(409, "Metadata observation identity mismatch")
        const observedAt = integer(o.observedAt, Math.max(Date.now() - 60000, d.grant.dispatchExpiresAt + METADATA_SETTLE_MS + 1), Date.now() + 1000)
        if (o.status === "match" && (o.content !== d.grant.content || !equalMetadataEmbed(o.embed, d.grant.embed)) || o.status !== "match" && (o.content !== undefined || o.embed !== undefined)) fail(409, "Metadata canonical observation mismatch")
        if (o.status === "unknown" || o.status === "conflict") return { duplicate: false, type: "reconciled", recorded: false, record: publicMetadataRecord(row) }
        if (d.resolution && d.resolution !== o.status) fail(409, "Metadata reconciliation already resolved")
        if (d.resolution) return { duplicate: false, type: "reconciled", recorded: false, record: publicMetadataRecord(row) }
        const record = await metadataDelivery(ctx, row, { ...d, resolution: o.status as "match" | "absent", reconciledAt: observedAt })
        return { duplicate: false, type: "reconciled", recorded: true, record }
    } else fail(400, "Unknown metadata management operation")
} })

function metadataPrivate(value: unknown, actorId: string, botId: string) {
    const p = decode(MetadataLogsPrivateRead, value)
    requireId(p.channelId)
    if (!Array.isArray(p.recipientIds) || p.recipientIds.length !== 2) fail(403, "Verified one-to-one private report required")
    const recipients = metadataIds(p.recipientIds, 2)
    if (p.oneToOne !== true || recipients.length !== 2 || !recipients.includes(actorId) || !recipients.includes(botId) || actorId === botId) fail(403, "Verified one-to-one private report required")
}
export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<MetadataLogsQueryResult> => {
    const input = decode(MetadataLogsQueryRequest, request), serverId = input.serverId; requireServer(serverId)
    const op = input.operation, context = metadataContext(input.context, true)
    await metadataAdmin(ctx, serverId, context, true)
    // Reports reach admins privately, bound to the reading admin, the bot and that DM
    if (context.channelType === 1 || op.type === "counters") {
        if (input.privateRead === undefined) fail(403, "Verified one-to-one private report required")
        metadataPrivate(input.privateRead, context.actor.userId, context.botId)
        if (context.channelType === 1 && (input.privateRead as { channelId: string }).channelId !== context.channelId) fail(403, "Private report channel mismatch")
    }
    if (op.type === "settings") { return { type: "settings", settings: publicMetadataSettings(await readMetadataSettings(ctx, serverId)) } }
    if (op.type === "show") { return { type: "record", record: publicMetadataRecord(await metadataRecord(ctx, serverId, metadataNumber(op.recordNo))) } }
    if (op.type === "list") {
        // A page of 10 for !logs events list. The eleventh row only tells whether another page follows
        const before = op.beforeRecordNo === undefined ? Number.MAX_SAFE_INTEGER : metadataNumber(op.beforeRecordNo), rows = await ctx.db.query("metadataLogRecords").withIndex("by_number", q => q.eq("serverId", serverId).lt("recordNo", before)).order("desc").take(11), selected = rows.slice(0, 10)
        return { type: "records", records: selected.map(publicMetadataRecord), ...(rows.length > 10 ? { nextBeforeRecordNo: selected.at(-1)!.recordNo } : {}) }
    }
    if (op.type === "counters") { return { type: "counters", counters: await metadataCounters(ctx, serverId) } }
    fail(400, "Unknown metadata query")
} })
