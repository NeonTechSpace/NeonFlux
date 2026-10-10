import { Schema } from "effect"
import { Id, Ids, IsoTime, List, Millis, PermissionBits, origin } from "./common.ts"

// Native reads that many features send with their requests

/** The bot's fresh read of the member who asked. nativePermissionAuthorized reports the permission the feature needs */
export const ModerationActor = Schema.Struct({ ...origin, userId: Id, roleIds: Ids(1000), isOwner: Schema.Boolean, isAdministrator: Schema.Boolean, nativePermissionAuthorized: Schema.Boolean })
export type ModerationActor = typeof ModerationActor.Type
/** The chat message that asked for a change */
export const ModerationSource = Schema.Struct({ messageId: Id, createdAt: Millis })
export type ModerationSource = typeof ModerationSource.Type

export const EventsMemberContext = Schema.Struct({ ...origin, userId: Id, joinedAt: IsoTime, roleIds: Ids(1000), isBot: Schema.Boolean, timeoutUntil: Schema.NullOr(IsoTime),
    canView: Schema.Boolean, canReadHistory: Schema.Boolean })
export type EventsMemberContext = typeof EventsMemberContext.Type

export const RolesRoleSnapshot = Schema.Struct({ ...origin, roleId: Id, permissions: PermissionBits, botCanManage: Schema.Boolean, actorCanManage: Schema.Boolean })
export type RolesRoleSnapshot = typeof RolesRoleSnapshot.Type
export const RolesMemberContext = Schema.Struct({ ...origin, userId: Id, joinedAt: IsoTime, roleIds: Ids(1000), isBot: Schema.Boolean, timeoutUntil: Schema.NullOr(IsoTime),
    botId: Id, botAuthorized: Schema.Boolean, roles: List(RolesRoleSnapshot, 1000) })
export type RolesMemberContext = typeof RolesMemberContext.Type

/** Who may use a member feature on the website. An empty allow list allows everyone */
export const MemberAccessLists = Schema.Struct({ allowRoleIds: Ids(100), blockRoleIds: Ids(100), allowUserIds: Ids(100), blockUserIds: Ids(100) })
export type MemberAccessLists = typeof MemberAccessLists.Type
