import { Schema } from "effect"
import { Id, Ids, IsoTime, List, Millis, PermissionBits, origin } from "./common.ts"

// Native reads that many features send with their requests

/** The bot's fresh read of the member who asked. nativePermissionAuthorized reports the permission the feature needs */
export const ModerationActor = Schema.Struct({
    ...origin,
    userId: Id,
    roleIds: Ids(1000),
    isOwner: Schema.Boolean,
    isAdministrator: Schema.Boolean,
    nativePermissionAuthorized: Schema.Boolean,
})
export type ModerationActor = typeof ModerationActor.Type
/** The chat message that asked for a change */
export const ModerationSource = Schema.Struct({ messageId: Id, createdAt: Millis })
export type ModerationSource = typeof ModerationSource.Type

export const ChannelMemberContext = Schema.Struct({
    ...origin,
    userId: Id,
    joinedAt: IsoTime,
    roleIds: Ids(1000),
    isBot: Schema.Boolean,
    timeoutUntil: Schema.NullOr(IsoTime),
    canView: Schema.Boolean,
    canReadHistory: Schema.Boolean,
})
export type ChannelMemberContext = typeof ChannelMemberContext.Type

export const RolesRoleSnapshot = Schema.Struct({
    ...origin,
    roleId: Id,
    permissions: PermissionBits,
    botCanManage: Schema.Boolean,
    actorCanManage: Schema.Boolean,
})
export type RolesRoleSnapshot = typeof RolesRoleSnapshot.Type
export const RolesMemberContext = Schema.Struct({
    ...origin,
    userId: Id,
    joinedAt: IsoTime,
    roleIds: Ids(1000),
    isBot: Schema.Boolean,
    timeoutUntil: Schema.NullOr(IsoTime),
    botId: Id,
    botAuthorized: Schema.Boolean,
    roles: List(RolesRoleSnapshot, 1000),
})
export type RolesMemberContext = typeof RolesMemberContext.Type

/**
 * Each role list holds up to 500 roles, so a website save that checks both lists' roles, with the server's role names,
 * fits one bot request of 262,144 characters. Each member list holds up to 5,000 members, which keeps a feature's four
 * lists, read on every member request, under half of one 512 KiB backup segment
 */
export const MEMBER_ACCESS_ROLES = 500,
    MEMBER_ACCESS_USERS = 5000
/** Who may use a member feature on the website. An empty allow list allows everyone */
export const MemberAccessLists = Schema.Struct({
    allowRoleIds: Ids(MEMBER_ACCESS_ROLES),
    blockRoleIds: Ids(MEMBER_ACCESS_ROLES),
    allowUserIds: Ids(MEMBER_ACCESS_USERS),
    blockUserIds: Ids(MEMBER_ACCESS_USERS),
})
export type MemberAccessLists = typeof MemberAccessLists.Type
/** Access list changes shared by member features. Chat commands add and remove entries, and the website replaces the lists */
export const MemberAccessOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("access-set"), ...MemberAccessLists.fields }),
    Schema.Struct({
        type: Schema.Literals(["access-add", "access-remove"]),
        list: Schema.Literals(["allow", "block"]),
        kind: Schema.Literals(["role", "user"]),
        /** One command adds or removes up to 100 entries, and the next command more */
        ids: Ids(100).check(Schema.isMinLength(1)),
    }),
])
export type MemberAccessOperation = typeof MemberAccessOperation.Type
