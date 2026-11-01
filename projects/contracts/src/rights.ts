import { Schema } from "effect"
import { Id, Int, List, Millis, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"

// Bot-only staff rights, see docs/BOT.md#bot-only-staff-rights

/** What a member may do through NeonFlux without the real Fluxer permission. A reversal follows its action's right, see rightForAction */
export const BotRight = Schema.Literals(["kick", "ban", "timeout", "purge", "slowmode", "lock", "quarantine", "jail"])
export type BotRight = typeof BotRight.Type
export const BOT_RIGHTS = BotRight.literals
const actionRights: Readonly<Record<string, BotRight>> = {
    kick: "kick",
    ban: "ban",
    unban: "ban",
    timeout: "timeout",
    untimeout: "timeout",
    purge: "purge",
    slowmode: "slowmode",
    lock: "lock",
    unlock: "lock",
    quarantine: "quarantine",
    release: "quarantine",
    jail: "jail",
    unjail: "jail",
}
/** The right a moderation action needs. A warning, a log or a message deletion has none, so they keep needing the real permission */
export const rightForAction = (action: string): BotRight | undefined =>
    Object.hasOwn(actionRights, action) ? actionRights[action] : undefined
/** Roles a server can grant rights to. Each grant is a decision of the owner, so a list this long is already far past any real use */
export const RIGHTS_ROLE_LIMIT = 50
export const RIGHTS_MAX_COUNT = 50,
    RIGHTS_MIN_MINUTES = 1,
    RIGHTS_MAX_MINUTES = 1440
/** All members together may use a right this many times its member limit in that limit's window */
export const RIGHTS_SERVER_FACTOR = 3
export const RightsLimit = Schema.Struct({
    count: Int(1, RIGHTS_MAX_COUNT),
    minutes: Int(RIGHTS_MIN_MINUTES, RIGHTS_MAX_MINUTES),
})
export type RightsLimit = typeof RightsLimit.Type
export const RightsLimits = Schema.Struct(
    Object.fromEntries(BOT_RIGHTS.map((right) => [right, RightsLimit])) as Record<BotRight, typeof RightsLimit>,
)
export type RightsLimits = typeof RightsLimits.Type
/** What a member may do per right in a sliding window while a server leaves the limits alone */
export const RIGHTS_DEFAULT_LIMITS: RightsLimits = {
    ban: { count: 3, minutes: 10 },
    kick: { count: 5, minutes: 10 },
    timeout: { count: 10, minutes: 10 },
    purge: { count: 5, minutes: 10 },
    slowmode: { count: 10, minutes: 10 },
    lock: { count: 5, minutes: 10 },
    quarantine: { count: 5, minutes: 10 },
    jail: { count: 3, minutes: 10 },
}
/** The rights whose limit a server raised above the default, which !health safety warns about */
export const rightsAboveDefault = (limits: RightsLimits) =>
    BOT_RIGHTS.filter(
        (right) =>
            limits[right].count / limits[right].minutes >
            RIGHTS_DEFAULT_LIMITS[right].count / RIGHTS_DEFAULT_LIMITS[right].minutes,
    )
const RightList = List(BotRight, BOT_RIGHTS.length).check(
    Schema.isMinLength(1),
    Schema.makeFilter((rights: readonly string[]) => new Set(rights).size === rights.length),
)
export const RightsGrant = Schema.Struct({ roleId: Id, rights: RightList })
export type RightsGrant = typeof RightsGrant.Type
export const RightsSettings = Schema.Struct({
    enabled: Schema.Boolean,
    grants: List(RightsGrant, RIGHTS_ROLE_LIMIT),
    limits: RightsLimits,
})
export type RightsSettings = typeof RightsSettings.Type
/** Off, no grants and the default limits: Every default refuses */
export const defaultRightsSettings = (): RightsSettings => ({
    enabled: false,
    grants: [],
    limits: RIGHTS_DEFAULT_LIMITS,
})
/** The rights a member's roles hold while rights are on. Help reads this from memory and only ever chooses what to show */
export const rightsOfRoles = (settings: RightsSettings, roleIds: readonly string[]): readonly BotRight[] =>
    settings.enabled
        ? BOT_RIGHTS.filter((right) =>
              settings.grants.some((grant) => roleIds.includes(grant.roleId) && grant.rights.includes(right)),
          )
        : []

/** on, grant, limit and clear are the owner's. off and revoke are also an Administrator's, at every DEFCON level */
export const RightsOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("module"), enabled: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("grant"), roleId: Id, rights: RightList }),
    /** Without rights it takes everything from the role */
    Schema.Struct({ type: Schema.Literal("revoke"), roleId: Id, rights: Schema.optionalKey(RightList) }),
    Schema.Struct({ type: Schema.Literal("limit"), right: BotRight, ...RightsLimit.fields }),
    Schema.Struct({ type: Schema.Literal("clear"), userId: Id }),
])
export type RightsOperation = typeof RightsOperation.Type
/** Whether the owner alone may make this change */
export const rightsOwnerOnly = (op: RightsOperation) =>
    op.type === "grant" || op.type === "limit" || op.type === "clear" || (op.type === "module" && op.enabled)
/** Whether this change only takes rights away, so it stays reachable at DEFCON 1 */
export const rightsCritical = (op: RightsOperation) => op.type === "revoke" || (op.type === "module" && !op.enabled)
export const RightsManageRequest = Schema.Struct({
    ...origin,
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    actor: ModerationActor,
    operation: RightsOperation,
})
export type RightsManageRequest = typeof RightsManageRequest.Type
export const RightsResult = Schema.Struct({ settings: RightsSettings })
export type RightsResult = typeof RightsResult.Type
/** The bot reads the settings once when a server starts. They only choose what to show, since the backend decides every action */
export const RightsGetRequest = Schema.Struct({ serverId: Id })
export type RightsGetRequest = typeof RightsGetRequest.Type
export const RightsSuspensionReason = Schema.Literals(["limit", "anti-nuke"])
export type RightsSuspensionReason = typeof RightsSuspensionReason.Type
export const RightsSuspension = Schema.Struct({
    userId: Id,
    reason: RightsSuspensionReason,
    right: Schema.optionalKey(BotRight),
    at: Millis,
})
export type RightsSuspension = typeof RightsSuspension.Type
/** How many suspended members a status names */
export const RIGHTS_SUSPENDED_PAGE = 10
/** What the chat status shows staff, naming who is suspended */
export const RightsStatus = Schema.Struct({
    settings: RightsSettings,
    suspended: List(RightsSuspension, RIGHTS_SUSPENDED_PAGE),
    moreSuspended: Schema.Boolean,
})
export type RightsStatus = typeof RightsStatus.Type
/** How many members a website count reaches */
export const RIGHTS_SUSPENDED_COUNT_LIMIT = 1000
/** What the dashboard section shows any server manager: A count and no names, which chat keeps to staff */
export const RightsView = Schema.Struct({
    settings: RightsSettings,
    suspendedCount: Int(0, RIGHTS_SUSPENDED_COUNT_LIMIT),
})
export type RightsView = typeof RightsView.Type
export const RightsStatusRequest = Schema.Struct({ serverId: Id, actor: ModerationActor })
export type RightsStatusRequest = typeof RightsStatusRequest.Type
/** Anti-nuke fired on this member. A refused bot action hurts nothing, so this applies in dry-run too */
export const RightsSuspendRequest = Schema.Struct({ serverId: Id, userId: Id })
export type RightsSuspendRequest = typeof RightsSuspendRequest.Type
/** admitted tells the bot a security record waits for delivery */
export const RightsSuspendResult = Schema.Struct({ suspended: Schema.Boolean, admitted: Schema.Boolean })
export type RightsSuspendResult = typeof RightsSuspendResult.Type
