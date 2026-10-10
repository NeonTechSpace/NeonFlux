import { Schema } from "effect"
import { Id, Int, List, Millis, Str, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"

// Sticky messages, see docs/BOT.md#sticky-messages

/** A server keeps at most five sticky channels. A busy channel gets at most one repost per interval, 30 seconds unless set */
export const STICKY_LIMIT = 5, STICKY_DEFAULT_INTERVAL = 30, STICKY_MIN_INTERVAL = 10, STICKY_MAX_INTERVAL = 3600
const content = Str(2000).check(Schema.makeFilter((value: string) => value.trim() !== ""))
const interval = Int(STICKY_MIN_INTERVAL, STICKY_MAX_INTERVAL)

/** One bot message kept at the bottom of a channel. messageId is the copy the bot posted last, null before its first post */
export const StickyMessage = Schema.Struct({ channelId: Id, content, intervalSeconds: interval, messageId: Schema.NullOr(Id), revision: Int(1), updatedAt: Millis })
export type StickyMessage = typeof StickyMessage.Type
/** Set creates a sticky or changes its text or interval. A new sticky needs text and starts with a 30 second interval */
export const StickyOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("set"), channelId: Id, content: Schema.optionalKey(content), intervalSeconds: Schema.optionalKey(interval) })
        .check(Schema.makeFilter(value => value.content !== undefined || value.intervalSeconds !== undefined)),
    Schema.Struct({ type: Schema.Literal("remove"), channelId: Id }),
])
export type StickyOperation = typeof StickyOperation.Type
/** Chat changes carry the server manager's fresh native authority, like the prefix */
export const StickyManageRequest = Schema.Struct({ ...origin, serverId: Id, messageId: Id, createdAt: Millis, actor: ModerationActor, managerAuthorized: Schema.Literal(true), operation: StickyOperation })
export type StickyManageRequest = typeof StickyManageRequest.Type
/** A removal returns the removed sticky, so the bot can delete the copy it posted last */
export const StickyManageResult = Schema.Struct({ type: Schema.Literals(["saved", "removed"]), sticky: StickyMessage })
export type StickyManageResult = typeof StickyManageResult.Type
export const StickyListRequest = Schema.Struct({ serverId: Id })
export type StickyListRequest = typeof StickyListRequest.Type
export const StickyListResult = Schema.Struct({ stickies: List(StickyMessage, STICKY_LIMIT) })
export type StickyListResult = typeof StickyListResult.Type
/** Records a new copy only while the sticky still has this revision and previous copy, so of two racing reposts exactly one is kept */
export const StickyPostedRequest = Schema.Struct({ serverId: Id, channelId: Id, revision: Int(1), previousMessageId: Schema.NullOr(Id), messageId: Id })
export type StickyPostedRequest = typeof StickyPostedRequest.Type
export const StickyPostedResult = Schema.Union([Schema.Struct({ accepted: Schema.Literal(true), sticky: StickyMessage }), Schema.Struct({ accepted: Schema.Literal(false), sticky: Schema.NullOr(StickyMessage) })])
export type StickyPostedResult = typeof StickyPostedResult.Type
