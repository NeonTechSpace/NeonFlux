import { Schema } from "effect"
import { Id, Ids, Int, Millis, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"

// Member list order, see docs/BOT.md#member-list-order

/** Set gives the hoisted roles' member-list display order from top to bottom. Reset clears every display position */
export const MemberListOperation = Schema.Union([
    // Fluxer lists at most 250 roles per server. Each role is named once
    Schema.Struct({ type: Schema.Literal("set"), roleIds: Ids(250).check(Schema.isMinLength(1), Schema.makeFilter((ids: string[]) => new Set(ids).size === ids.length)) }),
    Schema.Struct({ type: Schema.Literal("reset") }),
])
export type MemberListOperation = typeof MemberListOperation.Type
/** The bot applies the order natively before it records the change. Reset needs the owner or an Administrator */
export const MemberListManageRequest = Schema.Struct({ ...origin, serverId: Id, messageId: Id, createdAt: Millis, actor: ModerationActor, managerAuthorized: Schema.Literal(true), operation: MemberListOperation })
export type MemberListManageRequest = typeof MemberListManageRequest.Type
export const MemberListManageResult = Schema.Struct({ revision: Int(1) })
export type MemberListManageResult = typeof MemberListManageResult.Type
