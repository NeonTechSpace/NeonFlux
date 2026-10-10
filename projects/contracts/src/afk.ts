import { Schema } from "effect"
import { Id, Ids, List, Millis } from "./common.ts"

// AFK statuses. Observe runs for every ordinary message, so it clears the sender's status and reads the mentioned members' in one call

/** An away message has 1 to 200 characters once surrounding space is trimmed, and is stored trimmed */
export const AFK_REASON_LIMIT = 200, AFK_MENTION_LIMIT = 5
export const AfkSetRequest = Schema.Struct({ serverId: Id, userId: Id,
    reason: Schema.String.check(Schema.makeFilter((value: string) => { const length = value.trim().length; return length >= 1 && length <= AFK_REASON_LIMIT })) })
export type AfkSetRequest = typeof AfkSetRequest.Type
/** One active status. Set answers the saved one */
export const AfkStatus = Schema.Struct({ userId: Id, reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(AFK_REASON_LIMIT)), since: Millis })
export type AfkStatus = typeof AfkStatus.Type
/** The sender's own ID among the mentions is skipped */
export const AfkObserveRequest = Schema.Struct({ serverId: Id, userId: Id, mentionedUserIds: Ids(AFK_MENTION_LIMIT) })
export type AfkObserveRequest = typeof AfkObserveRequest.Type
/** cleared reports that the sender's own status ended. statuses are the mentioned members' active ones, each once */
export const AfkObserveResult = Schema.Struct({ cleared: Schema.Boolean,
    statuses: List(AfkStatus, AFK_MENTION_LIMIT).check(Schema.makeFilter(statuses => new Set(statuses.map(status => status.userId)).size === statuses.length)) })
export type AfkObserveResult = typeof AfkObserveResult.Type
