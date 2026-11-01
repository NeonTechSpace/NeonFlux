import { v } from "convex/values"
import {
    REMINDER_SERVER_LIMIT,
    REMINDER_WORK_BATCH,
    ReminderManageRequest,
    ReminderQueryRequest,
    ReminderWorkRequest,
    type ReminderManageResult,
    type ReminderQueryResult,
    type ReminderWorkResult,
} from "@neonflux/contracts/reminders"
import { changeConfiguration } from "./configurationChange.ts"
import { actor } from "./moderationDomain.ts"
import { blockingContentRule } from "./protection.ts"
import {
    applyReminderSettings,
    ensureReminderSettings,
    memberReminder,
    memberReminders,
    publicReminder,
    readReminderSettings,
    reminderDelivery,
    removeReminder,
} from "./remindersStore.ts"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { decode, fail, source } from "./validation.ts"

const DAY = 86400000,
    /** A claimed send that never reported counts as uncertain after this long, more than the sends of a batch take */
    CLAIM_MS = 300000,
    RETRY_MS = 60000,
    /** Uncertain and undelivered reminders stay visible this long, and a reminder may wait this long past its time */
    KEPT_MS = 30 * DAY

// A member's own reminders, and the settings managers change. Only settings changes reach the audit log, since staff see nothing else of a member's reminders
export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ReminderManageResult> => {
        const input = decode(ReminderManageRequest, request),
            identity = source(input, Date.now()),
            serverId = identity.serverId,
            who = actor(input.actor),
            op = input.operation,
            now = Date.now()
        if (op.type === "settings") {
            if (!input.managerAuthorized || !who.nativePermissionAuthorized)
                fail(403, "Manage community permission required")
            const settings = await changeConfiguration(
                ctx,
                serverId,
                "reminders",
                {
                    kind: "chat",
                    createdAt: identity.createdAt,
                    actor: { userId: who.userId, source: "command" },
                    operation: op,
                },
                () => applyReminderSettings(ctx, serverId, op.patch),
            )
            return { type: "settings", settings }
        }
        if (op.type === "cancel") {
            const row = await memberReminder(ctx, serverId, who.userId, op.reminderNo)
            if (!row) return { type: "refused", reason: "missing" }
            await removeReminder(ctx, row)
            return { type: "cancelled", reminderNo: op.reminderNo }
        }
        const settings = await readReminderSettings(ctx, serverId)
        if (!settings.enabled) return { type: "refused", reason: "off" }
        const held = await memberReminders(ctx, serverId, who.userId)
        if (held.length >= settings.memberLimit)
            return { type: "refused", reason: "member-limit", limit: settings.memberLimit }
        const row = await ensureReminderSettings(ctx, serverId)
        if (row.stored >= REMINDER_SERVER_LIMIT)
            return { type: "refused", reason: "server-limit", limit: REMINDER_SERVER_LIMIT }
        await ctx.db.patch(row._id, { stored: row.stored + 1 })
        const dueAt = now + op.seconds * 1000
        const id = await ctx.db.insert("reminders", {
            serverId,
            userId: who.userId,
            // One above the member's highest, so a number named from a list keeps meaning the same reminder
            reminderNo: (held.at(-1)?.reminderNo ?? 0) + 1,
            text: op.text,
            channelId: op.channelId,
            state: "active",
            due: true,
            dueAt,
            nextCheckAt: dueAt,
            createdAt: now,
            expiresAt: dueAt + KEPT_MS,
        })
        return { type: "created", reminder: publicReminder((await ctx.db.get(id))!) }
    },
})

export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ReminderQueryResult> => {
        const { serverId, userId } = decode(ReminderQueryRequest, request)
        const rows = userId ? await memberReminders(ctx, serverId, userId) : []
        return {
            settings: await readReminderSettings(ctx, serverId),
            reminders: rows.map(publicReminder).sort((a, b) => a.dueAt - b.dueAt),
        }
    },
})

// The bot's delivery worker. A reminder is claimed before it is sent and an unknown outcome is never sent again
export const work = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ReminderWorkResult> => {
        const { serverId, operation: op } = decode(ReminderWorkRequest, request),
            now = Date.now()
        if (op.type === "claim") {
            const lost = await ctx.db
                .query("reminders")
                .withIndex("by_server_due", (q) =>
                    q.eq("serverId", serverId).eq("state", "claimed").lte("nextCheckAt", now),
                )
                .take(REMINDER_WORK_BATCH)
            for (const row of lost)
                await ctx.db.patch(row._id, { state: "uncertain", due: false, expiresAt: now + KEPT_MS })
            if (!(await reminderDelivery(ctx, serverId))) return { type: "claimed", reminders: [] }
            const due = await ctx.db
                .query("reminders")
                .withIndex("by_server_due", (q) =>
                    q.eq("serverId", serverId).eq("state", "active").lte("nextCheckAt", now),
                )
                .take(REMINDER_WORK_BATCH)
            for (const row of due) await ctx.db.patch(row._id, { state: "claimed", nextCheckAt: now + CLAIM_MS })
            return {
                type: "claimed",
                reminders: due.map((row) => ({
                    userId: row.userId,
                    reminderNo: row.reminderNo,
                    text: row.text,
                    channelId: row.channelId,
                })),
            }
        }
        const row = await memberReminder(ctx, serverId, op.userId, op.reminderNo)
        if (op.type === "check")
            return {
                type: "check",
                allowed:
                    !!row &&
                    (await blockingContentRule(
                        ctx,
                        serverId,
                        row.text,
                        op.roleIds,
                        row.channelId,
                        op.parentChannelId,
                    )) === null,
            }
        // A member may have cancelled or deleted it while it was being sent
        if (row?.state !== "claimed") return { type: "recorded", recorded: false }
        if (op.outcome === "delivered" || op.outcome === "skipped") await removeReminder(ctx, row)
        else if (op.outcome === "retry") await ctx.db.patch(row._id, { state: "active", nextCheckAt: now + RETRY_MS })
        else await ctx.db.patch(row._id, { state: op.outcome, due: false, expiresAt: now + KEPT_MS })
        return { type: "recorded", recorded: true }
    },
})
