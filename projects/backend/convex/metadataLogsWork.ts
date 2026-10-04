import { v } from "convex/values"
import {
    MetadataLogsWorkRequest,
    type MetadataLogsDelivery,
    type MetadataLogsWorkResult,
} from "@neonflux/contracts/metadata-logs"
import { serviceMutation } from "./serviceGuard.ts"
import { internalMutation, type MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { internal } from "./_generated/api.js"
import { cleanupContext } from "./cleanupDomain.ts"
import { metadataBinding, metadataNumber, METADATA_GRANT_MS, METADATA_SETTLE_MS } from "./metadataLogsDomain.ts"
import {
    metadataAutomation,
    metadataBoundRecord,
    metadataCanonicalPayload,
    metadataDelivery,
    publicMetadataRecord,
    readMetadataSettings,
} from "./metadataLogsStore.ts"
import { readSettings } from "./moderationStore.ts"
import { ringWork } from "./workSignal.ts"
import { cursor, decode, fail, requireId, integer } from "./validation.ts"

export const METADATA_ATTEMPTS = 3
async function saveAttempt(
    ctx: MutationCtx,
    row: Doc<"metadataLogRecords">,
    delivery: MetadataLogsDelivery,
    claimToken?: string,
) {
    const attempt = await ctx.db
        .query("metadataLogAttempts")
        .withIndex("by_binding", (q) =>
            q.eq("serverId", row.serverId).eq("recordNo", row.recordNo).eq("generation", delivery.generation),
        )
        .unique()
    if (attempt) {
        if (attempt.delivery.grant && JSON.stringify(attempt.delivery.grant) !== JSON.stringify(delivery.grant))
            fail(409, "Metadata immutable intent changed")
        if (
            attempt.delivery.finishedAt !== undefined &&
            (attempt.delivery.state !== delivery.state || attempt.delivery.finishedAt !== delivery.finishedAt)
        )
            fail(409, "Metadata immutable outcome changed")
        await ctx.db.patch(attempt._id, { delivery, ...(claimToken ? { claimToken } : {}) })
    } else
        await ctx.db.insert("metadataLogAttempts", {
            serverId: row.serverId,
            recordNo: row.recordNo,
            generation: delivery.generation,
            delivery,
            ...(claimToken ? { claimToken } : {}),
        })
}
export async function settleMetadataReservation(ctx: MutationCtx, row: Doc<"metadataLogRecords">) {
    const d = row.delivery
    if (!d || d.state !== "reserved" || !d.grant || Date.now() <= d.grant.dispatchExpiresAt + METADATA_SETTLE_MS)
        return row
    const next: MetadataLogsDelivery = {
        ...d,
        state: d.claimedAt === undefined ? "failed" : "uncertain",
        finishedAt: Date.now(),
        nextCheckAt: Date.now() + 60000,
        ...(d.claimedAt === undefined ? { noDispatch: true } : {}),
    }
    await saveAttempt(ctx, row, next)
    await metadataDelivery(ctx, row, next)
    return (await ctx.db.get(row._id))!
}
/** Whether logging and the route a post was queued for are on, so the post may be delivered now */
function metadataDeliveryOpen(settings: Doc<"metadataLogSettings"> | null, row: Doc<"metadataLogRecords">) {
    const route = row.delivery?.routeEventType
        ? settings?.eventRoutes.find((r) => r.eventType === row.delivery!.routeEventType)
        : settings?.routes.find((r) => r.category === row.event.category)
    return !!settings?.enabled && !!route?.enabled
}
async function gateMetadataDelivery(ctx: MutationCtx, serverId: string, row: Doc<"metadataLogRecords">) {
    const settings = await readMetadataSettings(ctx, serverId)
    if (!settings || !metadataDeliveryOpen(settings, row)) fail(409, "Metadata delivery paused")
    return settings
}
/** The metadata settings posts are delivered under, or null while DEFCON 1 holds every post */
async function deliverySettings(ctx: MutationCtx, serverId: string) {
    if ((await readSettings(ctx, serverId))?.config.defcon === 1) return null
    return readMetadataSettings(ctx, serverId)
}
/** Records one wake transaction reads */
export const METADATA_WAKE_BATCH = 100
// A post found while DEFCON 1 holds delivery, or while logging or its route is off, waits with its record's expiry as its next
// check, so it is neither discovered nor counted as due work until then
const parked = (row: Doc<"metadataLogRecords">, now: number) =>
    row.actionable && row.nextCheckAt === row.expiresAt && row.nextCheckAt > now
/**
 * Makes the posts that waited while DEFCON 1 held delivery, or while logging or their route was off, due again once DEFCON allows
 * delivery and both are on. Each transaction reads one batch of records in number order and schedules the next, so a full store
 * stays within Convex's transaction limits
 */
export async function wakeMetadataDeliveries(ctx: MutationCtx, serverId: string, afterRecordNo = 0) {
    const settings = await deliverySettings(ctx, serverId),
        now = Date.now()
    if (!settings?.enabled) return 0
    const rows = await ctx.db
        .query("metadataLogRecords")
        .withIndex("by_number", (q) => q.eq("serverId", serverId).gt("recordNo", afterRecordNo))
        .take(METADATA_WAKE_BATCH)
    let woken = 0
    for (const row of rows)
        if (parked(row, now) && metadataDeliveryOpen(settings, row)) {
            await ctx.db.patch(row._id, { nextCheckAt: now })
            woken++
        }
    if (rows.length === METADATA_WAKE_BATCH)
        await ctx.scheduler.runAfter(0, internal.metadataLogsWork.wake, {
            serverId,
            afterRecordNo: rows.at(-1)!.recordNo,
        })
    return woken
}
// A scheduled batch is not part of a bot request whose answer reports new due work, so it rings the work signal itself
export const wake = internalMutation({
    args: { serverId: v.string(), afterRecordNo: v.number() },
    handler: async (ctx, { serverId, afterRecordNo }) => {
        if (await wakeMetadataDeliveries(ctx, serverId, afterRecordNo)) await ringWork(ctx)
    },
})
export const work = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<MetadataLogsWorkResult> => {
        const input = decode(MetadataLogsWorkRequest, request),
            serverId = input.serverId
        const op = input.operation,
            now = Date.now()
        if (op.type === "discover") {
            const settings = await deliverySettings(ctx, serverId)
            const page = await ctx.db
                .query("metadataLogRecords")
                .withIndex("by_work", (q) => q.eq("serverId", serverId).eq("actionable", true).lte("nextCheckAt", now))
                .paginate({ numItems: 20, cursor: cursor(op.cursor) })
            const records = []
            for (const record of page.page) {
                const row = await settleMetadataReservation(ctx, record)
                if (
                    row.expiresAt <= now &&
                    row.delivery &&
                    row.delivery.claimedAt === undefined &&
                    row.delivery.state !== "reserved"
                ) {
                    const next: MetadataLogsDelivery = {
                        ...row.delivery,
                        state: "cancelled",
                        noDispatch: true,
                        nextCheckAt: now,
                        finishedAt: now,
                    }
                    await metadataDelivery(ctx, row, next)
                } else if (
                    row.actionable &&
                    (row.delivery?.state === "queued" || (row.delivery?.state === "failed" && row.delivery.noDispatch))
                ) {
                    if (metadataDeliveryOpen(settings, row)) records.push(publicMetadataRecord(row))
                    else await ctx.db.patch(row._id, { nextCheckAt: row.expiresAt })
                }
            }
            return { type: "work", records, ...(!page.isDone ? { nextCursor: page.continueCursor } : {}) }
        }
        const binding = metadataBinding(op.binding),
            row = await metadataBoundRecord(ctx, serverId, binding),
            d = row.delivery
        if (op.type === "defer") {
            if (
                d.claimedAt !== undefined ||
                d.problem !== undefined ||
                !["queued", "failed"].includes(d.state) ||
                (d.state === "failed" && !d.noDispatch)
            )
                fail(409, "Metadata work cannot defer")
            return { type: "record", record: await metadataDelivery(ctx, row, { ...d, nextCheckAt: now + 60000 }) }
        }
        if (op.type === "destination-missing") {
            // Fluxer answered that the log channel does not exist. The post fails unsent for good, so it is not tried every minute,
            // and the failed count shows it to staff
            if (d.problem === "channel") return { type: "record", record: publicMetadataRecord(row) }
            if (
                d.claimedAt !== undefined ||
                row.claimToken !== undefined ||
                !(d.state === "queued" || d.state === "reserved" || (d.state === "failed" && d.noDispatch))
            )
                fail(409, "Metadata delivery cannot fail unsent")
            const next: MetadataLogsDelivery = {
                ...d,
                state: "failed",
                noDispatch: true,
                problem: "channel",
                finishedAt: d.finishedAt ?? now,
                nextCheckAt: now,
            }
            // A reservation keeps its attempt, which now records that nothing was sent
            if (d.state === "reserved") await saveAttempt(ctx, row, next)
            return { type: "record", record: await metadataDelivery(ctx, row, next) }
        }
        if (op.type === "reserve" || op.type === "claim") {
            const context = cleanupContext(op.context),
                settings = await gateMetadataDelivery(ctx, serverId, row)
            await metadataAutomation(ctx, serverId, context, d.channelId)
            if (op.type === "reserve") {
                if (row.expiresAt <= now) fail(409, "Metadata observation expired")
                if (
                    d.state === "reserved" &&
                    d.grant &&
                    d.claimedAt === undefined &&
                    d.grant.dispatchExpiresAt > now &&
                    d.moduleRevision === settings.revision
                )
                    return { type: "reserved", grant: d.grant }
                if (
                    d.state !== "queued" &&
                    !(d.state === "failed" && d.noDispatch && !d.problem && d.generation < METADATA_ATTEMPTS)
                )
                    fail(409, "Metadata delivery cannot replay")
                const generation = d.state === "failed" ? metadataNumber(d.generation + 1) : d.generation
                const freshBinding = { ...binding, moduleRevision: settings.revision, generation }
                const grant = {
                    ...freshBinding,
                    botId: context.botId,
                    dispatchExpiresAt: now + METADATA_GRANT_MS,
                    nativeDeadlineMs: 5000 as const,
                    ...metadataCanonicalPayload(row),
                }
                const next: MetadataLogsDelivery = {
                    ...freshBinding,
                    state: "reserved",
                    nextCheckAt: grant.dispatchExpiresAt + METADATA_SETTLE_MS + 1,
                    grant,
                }
                await saveAttempt(ctx, row, next)
                await metadataDelivery(ctx, row, next, { claimToken: undefined })
                return { type: "reserved", grant }
            }
            if (
                d.state !== "reserved" ||
                !d.grant ||
                d.moduleRevision !== settings.revision ||
                d.grant.botId !== context.botId ||
                d.grant.dispatchExpiresAt <= now
            )
                fail(409, "Metadata grant expired or superseded")
            if (d.claimedAt !== undefined) return { type: "claimed", claimed: false, grant: d.grant }
            const next = { ...d, claimedAt: now }
            await saveAttempt(ctx, row, next, op.claimToken)
            await metadataDelivery(ctx, row, next, { claimToken: op.claimToken })
            return { type: "claimed", claimed: true, grant: d.grant }
        }
        if (op.type === "outcome") {
            if (
                !d.grant ||
                d.claimedAt === undefined ||
                row.claimToken !== op.claimToken ||
                typeof op.claimToken !== "string" ||
                !/^[a-f0-9]{32}$/.test(op.claimToken)
            )
                fail(409, "Metadata claim capability required")
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
            const aged = now > d.grant.dispatchExpiresAt + METADATA_SETTLE_MS,
                unsent = !aged && op.outcome === "failed" && op.unsent
            const next: MetadataLogsDelivery = {
                ...d,
                state: aged ? "uncertain" : (op.outcome as "sent" | "failed" | "uncertain"),
                ...(unsent ? { noDispatch: true as const } : {}),
                finishedAt: now,
                // A post stopped by a rate limit waits a minute, so its tries do not all fall in one limit window
                nextCheckAt: unsent ? now + 60000 : now,
                ...(messageId ? { messageId } : {}),
            }
            await saveAttempt(ctx, row, next)
            if (unsent) {
                // Nothing was sent, so the post goes back unclaimed. Its attempt keeps the claim, and the next try reserves a new generation
                const { claimedAt: _claimed, ...open } = next
                return { type: "record", record: await metadataDelivery(ctx, row, open, { claimToken: undefined }) }
            }
            return { type: "record", record: await metadataDelivery(ctx, row, next) }
        }
        fail(400, "Unknown metadata work operation")
    },
})
