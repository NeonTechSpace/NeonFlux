import { Schema } from "effect"
import { Id, Int, List, Millis, Text, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"

// Personal reminders, see docs/BOT.md#personal-reminders

/** A reminder comes due from one minute to one year after it is set */
export const REMINDER_SECONDS = [60, 31536000] as const
export const REMINDER_TEXT_LENGTH = 500
/** The setting's range. A member's stored reminders count, whatever state they are in, so uncertain ones cannot pile up */
export const REMINDER_MEMBER_LIMITS = [1, 25] as const
/** Reminders one server stores at once. A deployment-wide bound on the storage one server can use, with no setting */
export const REMINDER_SERVER_LIMIT = 5000
export const REMINDER_DEFAULTS = { enabled: true, memberLimit: REMINDER_MEMBER_LIMITS[1] } as const
/** Due reminders the worker claims per request */
export const REMINDER_WORK_BATCH = 10

const memberLimit = Int(REMINDER_MEMBER_LIMITS[0], REMINDER_MEMBER_LIMITS[1])
/** The module switch and how many reminders one member may store. New servers have reminders on, since a member's reminder needs no setup and posts nothing while their DMs are open */
export const ReminderSettings = Schema.Struct({ enabled: Schema.Boolean, memberLimit })
export type ReminderSettings = typeof ReminderSettings.Type
export const ReminderSettingsPatch = Schema.Struct({
    enabled: Schema.optionalKey(Schema.Boolean),
    memberLimit: Schema.optionalKey(memberLimit),
}).check(Schema.makeFilter((value) => Object.keys(value).length > 0))
export type ReminderSettingsPatch = typeof ReminderSettingsPatch.Type
/** The text as the member typed it, with at least one visible character */
export const ReminderText = Text(REMINDER_TEXT_LENGTH)
/**
 * active waits for its time, sending was claimed by the worker, uncertain is a send with an unknown outcome, which NeonFlux never
 * repeats, and undelivered could not reach the member by DM or in its channel
 */
export const ReminderState = Schema.Literals(["active", "sending", "uncertain", "undelivered"])
export type ReminderState = typeof ReminderState.Type
/** One of a member's reminders. The number is the member's own, within the server */
export const Reminder = Schema.Struct({
    reminderNo: Int(1),
    text: ReminderText,
    channelId: Id,
    dueAt: Millis,
    state: ReminderState,
    createdAt: Millis,
})
export type Reminder = typeof Reminder.Type
export const ReminderOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), patch: ReminderSettingsPatch }),
    /** channelId is the channel the command was sent in, which a reminder that cannot be sent by DM uses */
    Schema.Struct({
        type: Schema.Literal("create"),
        seconds: Int(REMINDER_SECONDS[0], REMINDER_SECONDS[1]),
        text: ReminderText,
        channelId: Id,
    }),
    Schema.Struct({ type: Schema.Literal("cancel"), reminderNo: Int(1) }),
])
export type ReminderOperation = typeof ReminderOperation.Type
/** managerAuthorized is a fresh Manage community or Administrator read, which only settings need */
export const ReminderManageRequest = Schema.Struct({
    ...origin,
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    actor: ModerationActor,
    managerAuthorized: Schema.Boolean,
    operation: ReminderOperation,
})
export type ReminderManageRequest = typeof ReminderManageRequest.Type
export const ReminderRefusal = Schema.Literals(["off", "member-limit", "server-limit", "missing"])
export type ReminderRefusal = typeof ReminderRefusal.Type
export const ReminderManageResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings: ReminderSettings }),
    Schema.Struct({ type: Schema.Literal("created"), reminder: Reminder }),
    Schema.Struct({ type: Schema.Literal("cancelled"), reminderNo: Int(1) }),
    Schema.Struct({ type: Schema.Literal("refused"), reason: ReminderRefusal, limit: Schema.optionalKey(Int()) }),
])
export type ReminderManageResult = typeof ReminderManageResult.Type
/** The server's settings and, with userId, that member's own reminders, soonest first */
export const ReminderQueryRequest = Schema.Struct({ serverId: Id, userId: Schema.optionalKey(Id) })
export type ReminderQueryRequest = typeof ReminderQueryRequest.Type
export const ReminderQueryResult = Schema.Struct({
    settings: ReminderSettings,
    reminders: List(Reminder, REMINDER_MEMBER_LIMITS[1]),
})
export type ReminderQueryResult = typeof ReminderQueryResult.Type
/** What a claimed send names: delivered and skipped delete the reminder, retry sends it again later because nothing was sent yet */
export const ReminderOutcome = Schema.Literals(["delivered", "skipped", "uncertain", "undelivered", "retry"])
export type ReminderOutcome = typeof ReminderOutcome.Type
/**
 * claim marks up to ten due reminders as being sent and returns them, before the bot sends anything. A claim that never reported becomes
 * uncertain. check asks whether the server's content rules let NeonFlux post the text in the reminder's channel for a member with these roles
 */
export const ReminderWorkOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("claim") }),
    Schema.Struct({
        type: Schema.Literal("check"),
        userId: Id,
        reminderNo: Int(1),
        roleIds: List(Id, 250),
        parentChannelId: Schema.optionalKey(Id),
    }),
    Schema.Struct({ type: Schema.Literal("outcome"), userId: Id, reminderNo: Int(1), outcome: ReminderOutcome }),
])
export type ReminderWorkOperation = typeof ReminderWorkOperation.Type
export const ReminderWorkRequest = Schema.Struct({ serverId: Id, operation: ReminderWorkOperation })
export type ReminderWorkRequest = typeof ReminderWorkRequest.Type
export const ClaimedReminder = Schema.Struct({ userId: Id, reminderNo: Int(1), text: ReminderText, channelId: Id })
export type ClaimedReminder = typeof ClaimedReminder.Type
export const ReminderWorkResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("claimed"), reminders: List(ClaimedReminder, REMINDER_WORK_BATCH) }),
    /** allowed is false when a content rule would catch the text, or the reminder is gone */
    Schema.Struct({ type: Schema.Literal("check"), allowed: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("recorded"), recorded: Schema.Boolean }),
])
export type ReminderWorkResult = typeof ReminderWorkResult.Type
