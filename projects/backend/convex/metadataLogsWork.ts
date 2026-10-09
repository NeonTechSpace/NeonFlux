import { v } from "convex/values"
import type { MetadataLogsDelivery, MetadataLogsWorkResult } from "../contracts.js"
import { serviceMutation } from "./installations.ts"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { shape } from "./publishingDomain.ts"
import { cleanupContext } from "./cleanupDomain.ts"
import { metadataBinding, metadataNumber, METADATA_GRANT_MS, METADATA_SETTLE_MS } from "./metadataLogsDomain.ts"
import { metadataAutomation, metadataBoundRecord, metadataCanonicalPayload, metadataDelivery, publicMetadataRecord, readMetadataSettings } from "./metadataLogsStore.ts"
import { cursor, fail, requireId, requireServer, integer } from "./validation.ts"

export const METADATA_ATTEMPTS = 3
async function saveAttempt(ctx: MutationCtx, row: Doc<"metadataLogRecords">, delivery: MetadataLogsDelivery, claimToken?: string) {
    const attempt = await ctx.db.query("metadataLogAttempts").withIndex("by_binding", q => q.eq("serverId", row.serverId).eq("recordNo", row.recordNo).eq("generation", delivery.generation)).unique()
    if (attempt) {
        if (attempt.delivery.grant && JSON.stringify(attempt.delivery.grant) !== JSON.stringify(delivery.grant)) fail(409, "Metadata immutable intent changed")
        if (attempt.delivery.finishedAt !== undefined && (attempt.delivery.state !== delivery.state || attempt.delivery.finishedAt !== delivery.finishedAt)) fail(409, "Metadata immutable outcome changed")
        await ctx.db.patch(attempt._id, { delivery, ...(claimToken ? { claimToken } : {}) })
    } else await ctx.db.insert("metadataLogAttempts", { serverId: row.serverId, recordNo: row.recordNo, generation: delivery.generation, delivery, ...(claimToken ? { claimToken } : {}) })
}
export async function settleMetadataReservation(ctx: MutationCtx, row: Doc<"metadataLogRecords">) {
    const d = row.delivery
    if (!d || d.state !== "reserved" || !d.grant || Date.now() <= d.grant.dispatchExpiresAt + METADATA_SETTLE_MS) return row
    const next: MetadataLogsDelivery = { ...d, state: d.claimedAt === undefined ? "failed" : "uncertain", finishedAt: Date.now(), nextCheckAt: Date.now() + 60000, ...(d.claimedAt === undefined ? { noDispatch: true } : {}) }
    await saveAttempt(ctx, row, next)
    await metadataDelivery(ctx, row, next)
    return (await ctx.db.get(row._id))!
}
async function gateMetadataDelivery(ctx: MutationCtx, serverId: string, row: Doc<"metadataLogRecords">) {
    const settings = await readMetadataSettings(ctx, serverId)
    const route = row.delivery?.routeEventType ? settings?.eventRoutes?.find(r => r.eventType === row.delivery!.routeEventType) : settings?.routes.find(r => r.category === row.event.category)
    if (!settings?.enabled || !route?.enabled) fail(409, "Metadata delivery paused")
    return settings
}
export const work = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<MetadataLogsWorkResult> => {
    const input = shape(request, ["serverId", "operation"], ["serverId", "operation"]), serverId = requireId(input.serverId); requireServer(serverId)
    const op = shape(input.operation, ["type", "cursor", "binding", "context", "claimToken", "outcome", "messageId", "observedAt"]), now = Date.now()
    if (op.type === "discover") {
        shape(op, ["type", "cursor"], ["type"])
        if (op.cursor !== undefined && (typeof op.cursor !== "string" || op.cursor.length > 8192)) fail(400, "Invalid metadata work cursor")
        const page = await ctx.db.query("metadataLogRecords").withIndex("by_work", q => q.eq("serverId", serverId).eq("actionable", true).lte("nextCheckAt", now)).paginate({ numItems: 20, cursor: cursor(op.cursor) })
        const records = []
        for (const record of page.page) {
            const row = await settleMetadataReservation(ctx, record)
            if (row.expiresAt <= now && row.delivery && row.delivery.claimedAt === undefined && row.delivery.state !== "reserved") {
                const next: MetadataLogsDelivery = { ...row.delivery, state: "cancelled", noDispatch: true, nextCheckAt: now, finishedAt: now }
                await metadataDelivery(ctx, row, next)
            } else if (row.actionable && (row.delivery?.state === "queued" || row.delivery?.state === "failed" && row.delivery.noDispatch)) records.push(publicMetadataRecord(row))
        }
        return { type: "work", records, ...(!page.isDone ? { nextCursor: page.continueCursor } : {}) }
    }
    const binding = metadataBinding(op.binding), row = await metadataBoundRecord(ctx, serverId, binding), d = row.delivery
    if (op.type === "defer") {
        shape(op, ["type", "binding"], ["type", "binding"])
        if (d.claimedAt !== undefined || !["queued", "failed"].includes(d.state) || d.state === "failed" && !d.noDispatch) fail(409, "Metadata work cannot defer")
        return { type: "record", record: await metadataDelivery(ctx, row, { ...d, nextCheckAt: now + 60000 }) }
    }
    if (op.type === "no-dispatch") {
        shape(op, ["type", "binding"], ["type", "binding"])
        if (d.claimedAt !== undefined || row.claimToken !== undefined) fail(409, "Claimed metadata dispatch is uncertain")
        if (d.state === "failed" && d.noDispatch) return { type: "record", record: publicMetadataRecord(row) }
        if (d.state !== "reserved") fail(409, "Unclaimed metadata reservation required")
        const next: MetadataLogsDelivery = { ...d, state: "failed", noDispatch: true, finishedAt: now, nextCheckAt: now + 60000 }
        await saveAttempt(ctx, row, next)
        return { type: "record", record: await metadataDelivery(ctx, row, next) }
    }
    if (op.type === "reserve" || op.type === "claim") {
        shape(op, op.type === "reserve" ? ["type", "binding", "context"] : ["type", "binding", "context", "claimToken"], op.type === "reserve" ? ["type", "binding", "context"] : ["type", "binding", "context", "claimToken"])
        const context = cleanupContext(op.context), settings = await gateMetadataDelivery(ctx, serverId, row)
        await metadataAutomation(ctx, serverId, context, d.channelId)
        if (op.type === "reserve") {
            if (row.expiresAt <= now) fail(409, "Metadata observation expired")
            if (d.state === "reserved" && d.grant && d.claimedAt === undefined && d.grant.dispatchExpiresAt > now && d.moduleRevision === settings.revision) return { type: "reserved", grant: d.grant }
            if (d.state !== "queued" && !(d.state === "failed" && d.noDispatch && d.generation < METADATA_ATTEMPTS)) fail(409, "Metadata delivery cannot replay")
            const generation = d.state === "failed" ? metadataNumber(d.generation + 1) : d.generation
            const freshBinding = { ...binding, moduleRevision: settings.revision, generation }
            const grant = { ...freshBinding, botId: context.botId, dispatchExpiresAt: now + METADATA_GRANT_MS, nativeDeadlineMs: 5000 as const, ...metadataCanonicalPayload(row) }
            const next: MetadataLogsDelivery = { ...freshBinding, state: "reserved", nextCheckAt: grant.dispatchExpiresAt + METADATA_SETTLE_MS + 1, grant }
            await saveAttempt(ctx, row, next)
            await metadataDelivery(ctx, row, next, { claimToken: undefined })
            return { type: "reserved", grant }
        }
        if (typeof op.claimToken !== "string" || !/^[a-f0-9]{32}$/.test(op.claimToken)) fail(400, "Invalid metadata claim capability")
        if (d.state !== "reserved" || !d.grant || d.moduleRevision !== settings.revision || d.grant.botId !== context.botId || d.grant.dispatchExpiresAt <= now) fail(409, "Metadata grant expired or superseded")
        if (d.claimedAt !== undefined) return { type: "claimed", claimed: false, grant: d.grant }
        const next = { ...d, claimedAt: now }
        await saveAttempt(ctx, row, next, op.claimToken)
        await metadataDelivery(ctx, row, next, { claimToken: op.claimToken })
        return { type: "claimed", claimed: true, grant: d.grant }
    }
    if (op.type === "outcome") {
        shape(op, ["type", "binding", "claimToken", "outcome", "messageId", "observedAt"], ["type", "binding", "claimToken", "outcome", "observedAt"])
        if (!d.grant || d.claimedAt === undefined || row.claimToken !== op.claimToken || typeof op.claimToken !== "string" || !/^[a-f0-9]{32}$/.test(op.claimToken)) fail(409, "Metadata claim capability required")
        if (!["sent", "failed", "uncertain"].includes(String(op.outcome))) fail(400, "Invalid metadata delivery outcome")
        integer(op.observedAt, Math.max(0, d.claimedAt - 1000), now + 1000)
        const messageId = op.messageId === undefined ? undefined : requireId(op.messageId)
        if (op.outcome === "sent" && !messageId) fail(400, "Known metadata message required for sent outcome")
        if (messageId && d.messageId && d.messageId !== messageId) fail(409, "Metadata message identity changed")
        if (d.state !== "reserved") {
            if (!messageId || d.messageId) return { type: "record", record: publicMetadataRecord(row) }
            const next = { ...d, messageId }
            await saveAttempt(ctx, row, next)
            return { type: "record", record: await metadataDelivery(ctx, row, next) }
        }
        const aged = now > d.grant.dispatchExpiresAt + METADATA_SETTLE_MS
        const next: MetadataLogsDelivery = { ...d, state: aged ? "uncertain" : op.outcome as "sent" | "failed" | "uncertain", finishedAt: now, nextCheckAt: now, ...(messageId ? { messageId } : {}) }
        await saveAttempt(ctx, row, next)
        return { type: "record", record: await metadataDelivery(ctx, row, next) }
    }
    fail(400, "Unknown metadata work operation")
} })
