import { Schema } from "effect"
import { Id, Ids, Int, List, Millis, Text, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"

// The forum help desk, see docs/BOT.md#forum-help-desk

// A server's help desk serves up to ten forum channels and keeps up to 50 saved answers
export const HELPDESK_FORUM_LIMIT = 10, HELPDESK_ANSWER_LIMIT = 50
/** Reminders a work pass claims at most, so one pass stays small */
export const HELPDESK_NUDGES_PER_PASS = 25
const optional = Schema.optionalKey
const stored = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
const nudgeHours = Int(1, 168)
/** Names use lowercase letters, digits, - and _, and the command words list, set, remove and help are not names */
const answerName = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,31}$/), Schema.makeFilter((value: string) => !["list", "set", "remove", "help"].includes(value)))

/**
 * The help desk on up to ten forum or media channels. greeting null sends none, nudgeHours null sends no reply reminders,
 * and the thread budget guard runs while guardChannelId names a staff channel for warnings or autoArchive is on
 */
export const HelpDeskSettings = Schema.Struct({ forumIds: Ids(HELPDESK_FORUM_LIMIT), greeting: Schema.NullOr(stored(500)), solvedTag: stored(50), nudgeHours: Schema.NullOr(nudgeHours),
    guardChannelId: Schema.NullOr(Id), autoArchive: Schema.Boolean, revision: Int() })
export type HelpDeskSettings = typeof HelpDeskSettings.Type
/** A saved answer staff post with !answer. Names use lowercase letters, digits, - and _ */
export const HelpDeskAnswer = Schema.Struct({ name: stored(32), title: stored(100), content: stored(2000), updatedAt: Millis })
export type HelpDeskAnswer = typeof HelpDeskAnswer.Type
// Fluxer removes U+000C and U+202E and trims a tag name before its own 1 to 50 code unit check. The backend trims tags and titles
export const HelpDeskOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literals(["forum-add", "forum-remove"]), channelId: Id }),
    Schema.Struct({ type: Schema.Literal("settings"), greeting: optional(Schema.NullOr(Text(500))), solvedTag: optional(Text(50)), nudgeHours: optional(Schema.NullOr(nudgeHours)),
        guardChannelId: optional(Schema.NullOr(Id)), autoArchive: optional(Schema.Boolean) })
        .check(Schema.makeFilter(value => value.greeting !== undefined || value.solvedTag !== undefined || value.nudgeHours !== undefined || value.guardChannelId !== undefined || value.autoArchive !== undefined)),
    Schema.Struct({ type: Schema.Literal("answer-set"), name: answerName, title: Text(100), content: Text(2000) }),
    Schema.Struct({ type: Schema.Literal("answer-remove"), name: answerName }),
])
export type HelpDeskOperation = typeof HelpDeskOperation.Type
/** Settings changes carry the server manager's fresh authority. Answer changes may carry help desk staff authority instead: The owner, Administrator, Manage Server or Manage Threads */
export const HelpDeskManageRequest = Schema.Struct({ ...origin, serverId: Id, messageId: Id, createdAt: Millis, actor: ModerationActor, authorized: Schema.Literals(["manager", "staff"]), operation: HelpDeskOperation })
export type HelpDeskManageRequest = typeof HelpDeskManageRequest.Type
export const HelpDeskManageResult = Schema.Union([Schema.Struct({ type: Schema.Literal("settings"), settings: HelpDeskSettings }), Schema.Struct({ type: Schema.Literal("answer"), answer: HelpDeskAnswer }),
    Schema.Struct({ type: Schema.Literal("answer-removed"), name: stored(32) })])
export type HelpDeskManageResult = typeof HelpDeskManageResult.Type
export const HelpDeskGetRequest = Schema.Struct({ serverId: Id })
export type HelpDeskGetRequest = typeof HelpDeskGetRequest.Type
export const HelpDeskGetResult = Schema.Struct({ settings: HelpDeskSettings })
export type HelpDeskGetResult = typeof HelpDeskGetResult.Type
/** With a name, the one answer of that name or none. Without, the whole library */
export const HelpDeskAnswersRequest = Schema.Struct({ serverId: Id, name: optional(answerName) })
export type HelpDeskAnswersRequest = typeof HelpDeskAnswersRequest.Type
export const HelpDeskAnswersResult = Schema.Struct({ answers: List(HelpDeskAnswer, HELPDESK_ANSWER_LIMIT) })
export type HelpDeskAnswersResult = typeof HelpDeskAnswersResult.Type
/** A new post in a help desk forum, recorded for its reply reminder */
export const HelpDeskOpenedRequest = Schema.Struct({ serverId: Id, threadId: Id, forumId: Id })
export type HelpDeskOpenedRequest = typeof HelpDeskOpenedRequest.Type
export const HelpDeskOpenedResult = Schema.Struct({ recorded: Schema.Boolean })
export type HelpDeskOpenedResult = typeof HelpDeskOpenedResult.Type
export const HelpDeskWorkRequest = Schema.Struct({ serverId: Id })
export type HelpDeskWorkRequest = typeof HelpDeskWorkRequest.Type
/** Claimed reply reminders, whether more are due, and a thread budget pass when one is due */
export const HelpDeskWorkResult = Schema.Struct({ nudges: List(Schema.Struct({ threadId: Id, forumId: Id }), HELPDESK_NUDGES_PER_PASS), more: Schema.Boolean,
    guard: Schema.NullOr(Schema.Struct({ channelId: Schema.NullOr(Id), autoArchive: Schema.Boolean, threshold: Int(1, 1000) })) })
export type HelpDeskWorkResult = typeof HelpDeskWorkResult.Type
/** Sent after a pass that counted at least the threshold of active threads or left auto-archive changes for later */
export const HelpDeskGuardRequest = Schema.Struct({ serverId: Id, activeThreads: Int(0, 100000), more: Schema.Boolean })
export type HelpDeskGuardRequest = typeof HelpDeskGuardRequest.Type
export const HelpDeskGuardResult = Schema.Struct({ warn: Schema.Boolean })
export type HelpDeskGuardResult = typeof HelpDeskGuardResult.Type
