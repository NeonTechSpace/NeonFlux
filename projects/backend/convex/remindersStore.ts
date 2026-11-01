import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import {
    REMINDER_DEFAULTS,
    REMINDER_MEMBER_LIMITS,
    type Reminder,
    type ReminderSettings,
    type ReminderSettingsPatch,
} from "@neonflux/contracts/reminders"
import { defconHoldsAutomation } from "./schedulesStore.ts"
import { ringWork } from "./workSignal.ts"

type Read = QueryCtx | MutationCtx
export const reminderSettingsRow = (ctx: Read, serverId: string) =>
    ctx.db
        .query("reminderSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export async function readReminderSettings(ctx: Read, serverId: string): Promise<ReminderSettings> {
    const row = await reminderSettingsRow(ctx, serverId)
    return row ? { enabled: row.enabled, memberLimit: row.memberLimit } : { ...REMINDER_DEFAULTS }
}
/** The settings row, created on first use because it also counts the server's reminders */
export async function ensureReminderSettings(ctx: MutationCtx, serverId: string) {
    const row = await reminderSettingsRow(ctx, serverId)
    if (row) return row
    const id = await ctx.db.insert("reminderSettings", { serverId, ...REMINDER_DEFAULTS, stored: 0 })
    return (await ctx.db.get(id))!
}
/** Chat and dashboard share these rules. Turning reminders back on wakes the delivery that waited */
export async function applyReminderSettings(
    ctx: MutationCtx,
    serverId: string,
    patch: ReminderSettingsPatch,
): Promise<ReminderSettings> {
    const row = await ensureReminderSettings(ctx, serverId)
    await ctx.db.patch(row._id, patch)
    if (patch.enabled === true && !row.enabled) await ringWork(ctx)
    return readReminderSettings(ctx, serverId)
}
export const memberReminders = (ctx: Read, serverId: string, userId: string) =>
    ctx.db
        .query("reminders")
        .withIndex("by_number", (q) => q.eq("serverId", serverId).eq("userId", userId))
        .take(REMINDER_MEMBER_LIMITS[1])
export const memberReminder = (ctx: Read, serverId: string, userId: string, reminderNo: number) =>
    ctx.db
        .query("reminders")
        .withIndex("by_number", (q) => q.eq("serverId", serverId).eq("userId", userId).eq("reminderNo", reminderNo))
        .unique()
export const publicReminder = (row: Doc<"reminders">): Reminder => ({
    reminderNo: row.reminderNo,
    text: row.text,
    channelId: row.channelId,
    dueAt: row.dueAt,
    state: row.state === "claimed" ? "sending" : row.state,
    createdAt: row.createdAt,
})
/** Deletes a reminder and takes it out of the server's count */
export async function removeReminder(ctx: MutationCtx, row: Doc<"reminders">) {
    await ctx.db.delete(row._id)
    const settings = await reminderSettingsRow(ctx, row.serverId)
    if (settings) await ctx.db.patch(settings._id, { stored: Math.max(0, settings.stored - 1) })
}
/** Delivery waits while the module is off or DEFCON is below 3, and resumes after */
export const reminderDelivery = async (ctx: Read, serverId: string) =>
    (await readReminderSettings(ctx, serverId)).enabled && !(await defconHoldsAutomation(ctx, serverId))

const RETENTION_BATCH = 128
/** Retention: An uncertain or undelivered reminder expires 30 days after its send, and one that waited 30 days past its time goes too */
export async function cleanupReminders(ctx: MutationCtx, now: number) {
    const rows = await ctx.db
        .query("reminders")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(RETENTION_BATCH)
    for (const row of rows) await removeReminder(ctx, row)
    return { more: rows.length === RETENTION_BATCH }
}
