import { changeConfiguration } from "./configurationChange.ts"
import { v } from "convex/values"
import type { BackupConfigValues } from "@neonflux/contracts/backup"
import {
    SchedulesCalendar,
    SchedulesManageOperation,
    SchedulesManageRequest,
    SchedulesQueryRequest,
    type SchedulesContext,
    type SchedulesManageResult,
    type SchedulesQueryResult,
} from "@neonflux/contracts/schedules"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { canonicalPublishingContent, publishingContent, publishingName } from "./publishingDomain.ts"
import { reconcilePublishing, releaseConsumerPublication } from "./publishing.ts"
import { composerAdmin, composerContext } from "./publishingContext.ts"
import { advanceSchedule, validateScheduleCalendar, SCHEDULES_BATCH, SCHEDULES_PAGE } from "./schedulesDomain.ts"
import {
    addSchedulePlan,
    closeScheduleDelivery,
    extendSchedule,
    publicSchedule,
    publicScheduleDelivery,
    publisherSettings,
    scheduleCount,
    scheduleReceipt,
    scheduleRow,
    scheduleSettings,
    scheduleSnapshot,
    scheduleState,
    releaseSchedule,
    staleSchedules,
    upcomingSchedule,
} from "./schedulesStore.ts"
import { decode, fail, source, type ConfigurationIdentity } from "./validation.ts"
const publicSettings = (row: Doc<"scheduleSettings"> | null) => ({
    enabled: row?.enabled ?? false,
    revision: row?.revision ?? 1,
    activatedAt: row?.activatedAt ?? 0,
})
/** Closes the dates still waiting to post, and returns those not yet due, which a content or channel change stores again */
async function closeFuture(ctx: MutationCtx, row: Doc<"schedules">, now: number, cancel = false) {
    const copies: Doc<"scheduleDeliveries">[] = []
    // At most 26 stored dates have not come due, and due ones close within two days, so two pages hold them all
    for (let page = 0; page < 2; page++) {
        const rows = await ctx.db
            .query("scheduleDeliveries")
            .withIndex("by_schedule_active_due", (q) =>
                q
                    .eq("serverId", row.serverId)
                    .eq("scheduleNo", row.scheduleNo)
                    .eq("active", true)
                    .gt("dueAt", cancel ? -1 : now),
            )
            .take(SCHEDULES_BATCH)
        if (!rows.length) return copies
        for (const delivery of rows) {
            copies.push(delivery)
            // A replaced date that never started a post anchors nothing
            if (!cancel && delivery.attemptId === undefined && delivery.claimedAt === undefined) {
                await ctx.db.delete(delivery._id)
                continue
            }
            await closeScheduleDelivery(
                ctx,
                delivery,
                cancel ? "cancelled" : "superseded",
                cancel ? "cancelled" : "superseded",
                now,
            )
        }
        // Closing removes each row from the active index, including equal due times
        if (rows.length < SCHEDULES_BATCH) return copies
    }
    fail(503, "Schedule retained capacity conflict")
}
async function settled(ctx: MutationCtx, row: Doc<"scheduleDeliveries">) {
    const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
    if (row.active || (attempt && (attempt.outcome === "pending" || attempt.unresolved)))
        fail(409, "Unresolved schedule occurrence preserved")
    if (row.attemptId && !attempt) fail(503, "Schedule ownership anchor unavailable")
}
export async function forgetSchedule(ctx: MutationCtx, row: Doc<"schedules">, occurrenceNos?: number[]) {
    const selective = occurrenceNos !== undefined
    if (!selective) {
        if (
            await ctx.db
                .query("scheduleDeliveries")
                .withIndex("by_schedule_active_due", (q) =>
                    q.eq("serverId", row.serverId).eq("scheduleNo", row.scheduleNo).eq("active", true),
                )
                .first()
        )
            fail(409, "This schedule still has dates waiting to post. Cancel the schedule first", "REFUSED")
        if (
            await ctx.db
                .query("publishingAttempts")
                .withIndex("by_schedule_unresolved", (q) =>
                    q.eq("serverId", row.serverId).eq("consumer.scheduleNo", row.scheduleNo).eq("unresolved", true),
                )
                .first()
        )
            fail(409, "Unresolved schedule publication preserved")
    }
    const rows: Doc<"scheduleDeliveries">[] = []
    if (selective)
        for (const occurrenceNo of occurrenceNos) {
            const delivery = await ctx.db
                .query("scheduleDeliveries")
                .withIndex("by_schedule_occurrence", (q) =>
                    q.eq("serverId", row.serverId).eq("scheduleNo", row.scheduleNo).eq("occurrenceNo", occurrenceNo),
                )
                .unique()
            if (!delivery) fail(404, "Schedule occurrence not found")
            rows.push(delivery)
        }
    else
        rows.push(
            ...(await ctx.db
                .query("scheduleDeliveries")
                .withIndex("by_schedule_occurrence", (q) =>
                    q.eq("serverId", row.serverId).eq("scheduleNo", row.scheduleNo),
                )
                .take(SCHEDULES_BATCH)),
        )
    for (const delivery of rows) await settled(ctx, delivery)
    for (const delivery of rows) {
        await releaseConsumerPublication(ctx, delivery, "schedule")
        await ctx.db.delete(delivery._id)
    }
    const remaining = await ctx.db
        .query("scheduleDeliveries")
        .withIndex("by_schedule_occurrence", (q) => q.eq("serverId", row.serverId).eq("scheduleNo", row.scheduleNo))
        .first()
    const post = await ctx.db
        .query("publishingPosts")
        .withIndex("by_schedule", (q) => q.eq("serverId", row.serverId).eq("consumer.scheduleNo", row.scheduleNo))
        .first()
    const complete = selective || (!remaining && !post)
    if (!selective && complete) {
        await ctx.db.delete(row._id)
        if (!row.released) await scheduleCount(ctx, row.serverId, "definitions", -1)
    } else {
        await ctx.db.patch(row._id, {
            revision: advanceSchedule(row.revision),
            updatedAt: Date.now(),
            ...(!selective ? { enabled: false, cancelled: true, extendAt: undefined } : {}),
        })
        if (!selective) await releaseSchedule(ctx, row)
    }
    return {
        duplicate: false as const,
        type: "forgotten" as const,
        scheduleNo: row.scheduleNo,
        complete,
        removed: rows.length,
    }
}
export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<SchedulesManageResult> => {
        const input = decode(SchedulesManageRequest, request)
        const now = Date.now(),
            identity = source(input, now),
            context = composerContext(input.context),
            op = input.operation
        const critical =
            op.type === "disable" ||
            op.type === "cancel" ||
            op.type === "reconcile" ||
            op.type === "forget" ||
            (op.type === "settings" && op.enabled === false)
        await composerAdmin(ctx, identity.serverId, context, critical)
        if (!(await scheduleReceipt(ctx, identity, context.actor.userId, op))) return { duplicate: true }
        const apply = () =>
            applySchedulesManagement(
                ctx,
                {
                    serverId: identity.serverId,
                    actorId: context.actor.userId,
                    createdAt: identity.createdAt,
                    source: { kind: "chat", messageId: identity.messageId },
                },
                context,
                op,
                now,
            )
        if (op.type === "reconcile") return apply()
        return changeConfiguration(
            ctx,
            identity.serverId,
            "schedules",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: context.actor.userId, source: "command" },
                operation: op,
            },
            apply,
        )
    },
})
export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<SchedulesQueryResult> => {
        const { serverId, context: raw, operation: op } = decode(SchedulesQueryRequest, request)
        const context = composerContext(raw)
        await composerAdmin(ctx, serverId, context, true)
        const settings = await scheduleSettings(ctx, serverId)
        if (op.type === "settings" || op.type === "status") {
            if (op.type === "settings") return { type: "settings", settings: publicSettings(settings) }
            const publisher = await publisherSettings(ctx, serverId)
            return {
                type: "status",
                settings: publicSettings(settings),
                definitions: (settings?.definitions ?? 0) - (await staleSchedules(ctx, serverId)),
                receipts: settings?.receipts ?? 0,
                publishing: { enabled: publisher?.enabled ?? true },
                limits: { definitions: 50 },
            }
        }
        if (op.type === "show" && "name" in op) {
            // Names are unique in a server, so chat commands find a schedule by its name
            const name = publishingName(op.name),
                row = await ctx.db
                    .query("schedules")
                    .withIndex("by_name", (q) => q.eq("serverId", serverId).eq("name", name))
                    .unique()
            if (!row) fail(404, "Schedule not found")
            return { type: "schedule", schedule: publicSchedule(row, await upcomingSchedule(ctx, row, Date.now())) }
        }
        if (op.type === "show") {
            const row = await scheduleRow(ctx, serverId, op.scheduleNo)
            return { type: "schedule", schedule: publicSchedule(row, await upcomingSchedule(ctx, row, Date.now())) }
        }
        if (op.type === "list") {
            const before = op.beforeScheduleNo ?? Number.MAX_SAFE_INTEGER
            const rows = await ctx.db
                .query("schedules")
                .withIndex("by_number", (q) => q.eq("serverId", serverId).lt("scheduleNo", before))
                .order("desc")
                .take(SCHEDULES_PAGE)
            const last = rows.at(-1),
                more = last
                    ? await ctx.db
                          .query("schedules")
                          .withIndex("by_number", (q) => q.eq("serverId", serverId).lt("scheduleNo", last.scheduleNo))
                          .first()
                    : null
            return {
                type: "schedules",
                schedules: rows.map((row) => publicSchedule(row)),
                ...(more ? { nextBeforeScheduleNo: last!.scheduleNo } : {}),
            }
        }
        if (op.type !== "deliveries") fail(400, "Invalid schedule query")
        const row = await scheduleRow(ctx, serverId, op.scheduleNo),
            after = op.afterOccurrenceNo ?? 0
        const rows = await ctx.db
            .query("scheduleDeliveries")
            .withIndex("by_schedule_occurrence", (q) =>
                q.eq("serverId", serverId).eq("scheduleNo", row.scheduleNo).gt("occurrenceNo", after),
            )
            .take(SCHEDULES_PAGE)
        const last = rows.at(-1),
            more = last
                ? await ctx.db
                      .query("scheduleDeliveries")
                      .withIndex("by_schedule_occurrence", (q) =>
                          q
                              .eq("serverId", serverId)
                              .eq("scheduleNo", row.scheduleNo)
                              .gt("occurrenceNo", last.occurrenceNo),
                      )
                      .first()
                : null
        const deliveries = rows.map(publicScheduleDelivery)
        return { type: "deliveries", deliveries, ...(more ? { nextAfterOccurrenceNo: last!.occurrenceNo } : {}) }
    },
})

/**
 * A backup restore's schedule, by name, made or changed in place with the archived content. It is on only while every date is ahead, which
 * the feature's own calendar check decides, and a paused one keeps its dates for the owner to change. A cancelled schedule stays cancelled
 */
export async function restoreSchedule(
    ctx: MutationCtx,
    serverId: string,
    actorId: string,
    value: BackupConfigValues["schedule"],
    now: number,
) {
    const name = publishingName(value.name),
        calendar = value.enabled
            ? validateScheduleCalendar(value.calendar, now)
            : decode(SchedulesCalendar, value.calendar),
        content = publishingContent(value.content, true),
        existing = await ctx.db
            .query("schedules")
            .withIndex("by_name", (q) => q.eq("serverId", serverId).eq("name", name))
            .unique()
    const fields = {
        channelId: value.channelId,
        calendar,
        source: value.source,
        content,
        canonicalContent: canonicalPublishingContent(content),
        enabled: value.enabled,
        updatedAt: now,
    }
    if (existing?.cancelled) fail(409, "A cancelled schedule stays cancelled")
    if (existing) {
        await closeFuture(ctx, existing, now)
        // The archived calendar stores its first dates and counts again if the old one had run out
        if (existing.released) await scheduleCount(ctx, serverId, "definitions", 1)
        await ctx.db.patch(existing._id, {
            ...fields,
            revision: advanceSchedule(existing.revision),
            planRevision: advanceSchedule(existing.planRevision),
            nextIndex: undefined,
            lastSkipped: undefined,
            released: undefined,
            ...(value.enabled && !existing.enabled ? { activatedAt: now } : {}),
        })
        await restorePlan(ctx, (await ctx.db.get(existing._id))!, now)
        return
    }
    await scheduleCount(ctx, serverId, "definitions", 1)
    const current = await scheduleState(ctx, serverId),
        scheduleNo = current.nextScheduleNo
    await ctx.db.patch(current._id, { nextScheduleNo: advanceSchedule(scheduleNo) })
    const id = await ctx.db.insert("schedules", {
        serverId,
        scheduleNo,
        name,
        revision: 1,
        planRevision: 1,
        createdBy: actorId,
        ...fields,
        cancelled: false,
        activatedAt: value.enabled ? now : 0,
        createdAt: now,
    })
    await restorePlan(ctx, (await ctx.db.get(id))!, now)
}
/** A restored schedule's stored dates that are still ahead, then the rest of its repeat */
async function restorePlan(ctx: MutationCtx, row: Doc<"schedules">, now: number) {
    await addSchedulePlan(
        ctx,
        row,
        row.calendar.dates.filter((date) => date.dueAt > now),
        now,
    )
    await extendSchedule(ctx, row, now)
}
// Dashboard jobs pass their stored operation, so it is decoded here as well
export async function applySchedulesManagement(
    ctx: MutationCtx,
    identity: ConfigurationIdentity,
    context: SchedulesContext | undefined,
    value: unknown,
    now: number,
): Promise<SchedulesManageResult> {
    const op = decode(SchedulesManageOperation, value),
        current = await scheduleState(ctx, identity.serverId)
    if (op.type === "settings") {
        if (op.expectedRevision !== current.revision) fail(409, "Schedule settings changed")
        const enabled = op.enabled
        await ctx.db.patch(current._id, {
            enabled,
            revision: advanceSchedule(current.revision),
            ...(enabled && !current.enabled ? { activatedAt: now } : {}),
        })
        return { duplicate: false, type: "settings", settings: publicSettings((await ctx.db.get(current._id))!) }
    }
    if (op.type === "create") {
        if (!context) fail(403, "Native schedule owner required")
        const name = publishingName(op.name),
            channelId = op.channelId,
            calendar = validateScheduleCalendar(op.calendar, now),
            snapshot = await scheduleSnapshot(ctx, identity.serverId, op.source)
        if (context.channelId !== channelId || !context.actorAuthorized || !context.botAuthorized)
            fail(403, "Schedule destination permission required")
        if (
            await ctx.db
                .query("schedules")
                .withIndex("by_name", (q) => q.eq("serverId", identity.serverId).eq("name", name))
                .unique()
        )
            fail(409, "A schedule with that name already exists. Choose another name", "REFUSED")
        await scheduleCount(ctx, identity.serverId, "definitions", 1)
        const scheduleNo = current.nextScheduleNo
        await ctx.db.patch(current._id, { nextScheduleNo: advanceSchedule(scheduleNo) })
        const id = await ctx.db.insert("schedules", {
            serverId: identity.serverId,
            scheduleNo,
            name,
            revision: 1,
            planRevision: 1,
            createdBy: identity.actorId,
            channelId,
            calendar,
            source: snapshot.source,
            content: snapshot.content,
            canonicalContent: snapshot.canonicalContent,
            enabled: false,
            cancelled: false,
            activatedAt: 0,
            createdAt: now,
            updatedAt: now,
        })
        const row = (await ctx.db.get(id))!
        await addSchedulePlan(ctx, row, calendar.dates, now)
        await extendSchedule(ctx, row, now)
        return { duplicate: false, type: "schedule", schedule: publicSchedule((await ctx.db.get(id))!) }
    }
    const row = await scheduleRow(ctx, identity.serverId, op.scheduleNo, op.expectedRevision)
    if (op.type === "forget") return forgetSchedule(ctx, row, op.occurrenceNos)
    if (op.type === "reconcile") {
        const id = ctx.db.normalizeId("scheduleDeliveries", op.deliveryId),
            delivery = id ? await ctx.db.get(id) : null
        if (
            !delivery ||
            delivery.serverId !== row.serverId ||
            delivery.scheduleNo !== row.scheduleNo ||
            delivery.attemptId !== op.attemptId
        )
            fail(409, "Schedule occurrence changed")
        const attempt = await ctx.db.get(delivery.attemptId),
            post = await ctx.db
                .query("publishingPosts")
                .withIndex("by_server_post", (q) => q.eq("serverId", row.serverId).eq("postNo", delivery.postNo!))
                .unique()
        if (
            !attempt ||
            attempt.generation !== op.expectedGeneration ||
            !post ||
            post.attemptId !== attempt._id ||
            attempt.consumer?.type !== "schedule" ||
            attempt.consumer.deliveryId !== delivery._id
        )
            fail(409, "Schedule publication changed")
        const result = await reconcilePublishing(ctx, post, attempt, op.observation)
        await ctx.db.patch(row._id, { revision: advanceSchedule(row.revision), updatedAt: now })
        return { duplicate: false, type: "reconciled", ...result }
    }
    if (op.type === "cancel") {
        await closeFuture(ctx, row, now, true)
        await ctx.db.patch(row._id, {
            cancelled: true,
            enabled: false,
            extendAt: undefined,
            revision: advanceSchedule(row.revision),
            updatedAt: now,
        })
        await releaseSchedule(ctx, row)
    } else if (op.type === "enable" || op.type === "disable") {
        if (op.type === "enable" && row.cancelled)
            fail(409, "A cancelled schedule stays cancelled. Create a new schedule instead", "REFUSED")
        const enabled = op.type === "enable"
        await ctx.db.patch(row._id, {
            enabled,
            revision: advanceSchedule(row.revision),
            updatedAt: now,
            ...(enabled && !row.enabled ? { activatedAt: now } : {}),
        })
    } else {
        if (row.cancelled) fail(409, "A cancelled schedule stays cancelled. Create a new schedule instead", "REFUSED")
        let patch: Partial<Doc<"schedules">> = {}
        if (op.type === "content") patch = await scheduleSnapshot(ctx, row.serverId, op.source)
        else if (op.type === "calendar") patch = { calendar: validateScheduleCalendar(op.calendar, now) }
        else if (op.type === "destination") {
            if (!context) fail(403, "Native schedule owner required")
            const channelId = op.channelId
            if (context.channelId !== channelId || !context.actorAuthorized || !context.botAuthorized)
                fail(403, "Schedule destination permission required")
            patch = { channelId }
        }
        const copies = await closeFuture(ctx, row, now)
        await ctx.db.patch(row._id, {
            ...patch,
            revision: advanceSchedule(row.revision),
            planRevision: advanceSchedule(row.planRevision),
            updatedAt: now,
        })
        if (op.type === "calendar") {
            // A new calendar stores its first dates and counts again if the old one had run out
            if (row.released) await scheduleCount(ctx, row.serverId, "definitions", 1)
            await ctx.db.patch(row._id, { nextIndex: undefined, lastSkipped: undefined, released: undefined })
            const next = (await ctx.db.get(row._id))!
            await addSchedulePlan(ctx, next, next.calendar.dates, now)
            await extendSchedule(ctx, next, now)
        } else
            // Other changes store the same instants again, so a changed zone database never moves a planned post
            await addSchedulePlan(ctx, (await ctx.db.get(row._id))!, copies, now)
    }
    return { duplicate: false, type: "schedule", schedule: publicSchedule((await ctx.db.get(row._id))!) }
}
