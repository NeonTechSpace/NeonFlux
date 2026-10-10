import { Schema } from "effect"
import { Cursor, Id, Int, IsoTime, List, Millis, Token, origin } from "./common.ts"
import { ModerationActor, RolesMemberContext } from "./shared.ts"

// Temporary roles, see docs/BOT.md#temporary-roles

/** Durations run from one minute to 365 days. A member holds at most 25 temporary roles, and at most 100 roles per server have defaults */
export const TEMPORARY_ROLE_MIN_SECONDS = 60, TEMPORARY_ROLE_MAX_SECONDS = 365 * 86400, TEMPORARY_ROLE_MEMBER_GRANTS = 25, TEMPORARY_ROLE_DEFAULTS = 100
const seconds = Int(TEMPORARY_ROLE_MIN_SECONDS, TEMPORARY_ROLE_MAX_SECONDS)
// A membership start as a grant keeps it
const joinedAt = Schema.String.check(Schema.makeFilter((value: string) => value.length <= 64 && Number.isFinite(Date.parse(value))))

/**
 * Why a temporary role is not settled yet. permission: NeonFlux lacks Manage Roles. role: The role ranks at or above NeonFlux's highest role,
 * has more than ordinary member permissions or is a staff role. refused: Fluxer refused the change. uncertain: Fluxer did not confirm a change,
 * which is never repeated until a reconcile reads the member. unavailable: The member or the server's roles could not be read
 */
export const TemporaryRoleProblem = Schema.Literals(["permission", "role", "refused", "uncertain", "unavailable"])
export type TemporaryRoleProblem = typeof TemporaryRoleProblem.Type
/** One member's temporary role during one membership. NeonFlux removes the role at endsAt. sourceId names this version of the grant in role attempts */
export const TemporaryRoleGrant = Schema.Struct({ grantId: Token, userId: Id, roleId: Id, joinedAt, endsAt: Millis, grantedBy: Id, createdAt: Millis, updatedAt: Millis, sourceId: Token,
    problem: Schema.optionalKey(TemporaryRoleProblem) })
export type TemporaryRoleGrant = typeof TemporaryRoleGrant.Type
/** A role's default and longest duration in seconds */
export const TemporaryRoleDefault = Schema.Struct({ roleId: Id, defaultSeconds: Schema.optionalKey(seconds), maxSeconds: Schema.optionalKey(seconds) })
export type TemporaryRoleDefault = typeof TemporaryRoleDefault.Type
export const TemporaryRoleSettings = Schema.Struct({ roles: List(TemporaryRoleDefault, TEMPORARY_ROLE_DEFAULTS) })
export type TemporaryRoleSettings = typeof TemporaryRoleSettings.Type
export const TemporaryRoleState = Schema.Struct({ revision: Int(), settings: TemporaryRoleSettings })
export type TemporaryRoleState = typeof TemporaryRoleState.Type
/**
 * add and set need the member's fresh context. add without durationSeconds uses the role's default, and set counts its duration from now.
 * remove ends the grant now, and the bot then removes the role. role changes a role's defaults: An omitted value is kept and null clears it
 */
export const TemporaryRoleOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("add"), userId: Id, roleId: Id, durationSeconds: Schema.optionalKey(seconds) }),
    Schema.Struct({ type: Schema.Literal("set"), userId: Id, roleId: Id, durationSeconds: seconds }),
    Schema.Struct({ type: Schema.Literal("remove"), userId: Id, roleId: Id }),
    Schema.Struct({ type: Schema.Literal("role"), roleId: Id, defaultSeconds: Schema.optionalKey(Schema.NullOr(seconds)), maxSeconds: Schema.optionalKey(Schema.NullOr(seconds)) }),
])
export type TemporaryRoleOperation = typeof TemporaryRoleOperation.Type
/** actor.nativePermissionAuthorized means Manage Roles for grants and Manage Server for role defaults */
export const TemporaryRoleManageRequest = Schema.Struct({ serverId: Id, messageId: Id, createdAt: Millis, actor: ModerationActor, context: Schema.optionalKey(RolesMemberContext),
    operation: TemporaryRoleOperation })
export type TemporaryRoleManageRequest = typeof TemporaryRoleManageRequest.Type
const settings = Schema.Struct({ type: Schema.Literal("settings"), ...TemporaryRoleState.fields })
const grants = List(TemporaryRoleGrant, TEMPORARY_ROLE_MEMBER_GRANTS)
export const TemporaryRoleManageResult = Schema.Union([Schema.Struct({ type: Schema.Literal("grant"), grant: TemporaryRoleGrant }), settings])
export type TemporaryRoleManageResult = typeof TemporaryRoleManageResult.Type
export const TemporaryRoleQueryRequest = Schema.Struct({ serverId: Id, actor: ModerationActor,
    operation: Schema.Union([Schema.Struct({ type: Schema.Literal("list"), userId: Schema.optionalKey(Id), cursor: Schema.optionalKey(Cursor) }), Schema.Struct({ type: Schema.Literal("settings") })]) })
export type TemporaryRoleQueryRequest = typeof TemporaryRoleQueryRequest.Type
export const TemporaryRoleQueryResult = Schema.Union([Schema.Struct({ type: Schema.Literal("grants"), grants, nextCursor: Schema.optionalKey(Cursor) }), settings])
export type TemporaryRoleQueryResult = typeof TemporaryRoleQueryResult.Type
/**
 * list returns the server's due grants. end closes a grant without a role change, because its member left or rejoined or its role was deleted.
 * problem keeps a grant with the reason it is not settled and checks it again later
 */
export const TemporaryRoleWorkOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("list") }),
    // A member end carries explicit absence evidence exactly when the member has no current membership
    Schema.Struct({ ...origin, type: Schema.Literal("end"), userId: Id, roleId: Id, sourceId: Token, reason: Schema.Literal("member"), currentJoinedAt: Schema.NullOr(IsoTime),
        memberAbsent: Schema.optionalKey(Schema.Literal(true)), memberUserId: Schema.optionalKey(Schema.String), observedAt: Millis })
        .check(Schema.makeFilter(value => value.currentJoinedAt === null ? value.memberAbsent === true : value.memberAbsent === undefined)),
    Schema.Struct({ type: Schema.Literal("end"), userId: Id, roleId: Id, sourceId: Token, reason: Schema.Literal("role") }),
    Schema.Struct({ type: Schema.Literal("problem"), userId: Id, roleId: Id, sourceId: Token, problem: TemporaryRoleProblem }),
])
export type TemporaryRoleWorkOperation = typeof TemporaryRoleWorkOperation.Type
export const TemporaryRoleWorkRequest = Schema.Struct({ serverId: Id, operation: TemporaryRoleWorkOperation })
export type TemporaryRoleWorkRequest = typeof TemporaryRoleWorkRequest.Type
export const TemporaryRoleWorkResult = Schema.Union([Schema.Struct({ type: Schema.Literal("grants"), grants }), Schema.Struct({ type: Schema.Literal("recorded"), recorded: Schema.Boolean })])
export type TemporaryRoleWorkResult = typeof TemporaryRoleWorkResult.Type
