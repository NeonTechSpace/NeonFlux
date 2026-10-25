import { Schema } from "effect"
import { Id, Ids, Int, InviteCode, List, Millis, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"

// Security alerts and invites, see docs/BOT.md#security-alerts-and-invites

// Convex keeps at most 8,192 values in one array, so each expected list holds up to that many IDs. The dashboard shows the
// invites a page of this many at a time
export const ALERT_EXPECTED_LIMIT = 8192,
    ALERT_INVITE_PAGE = 100
const time = Schema.String.check(
    Schema.makeFilter((value: string) => value.length <= 64 && Number.isFinite(Date.parse(value))),
)
const count = Int(0, 2147483647)

/** Security alerts a server can turn on. Every alert starts off */
export const AlertKind = Schema.Literals(["invites", "bots", "webhooks", "privileges", "impersonation"])
export type AlertKind = typeof AlertKind.Type
/** Actions NeonFlux may take on an alert. Each starts off and runs only while its alert is on */
export const AlertAction = Schema.Literals(["kickBots", "deleteWebhooks", "removePermissions"])
export type AlertAction = typeof AlertAction.Type
/** The alert each action belongs to, and the name its records use */
export const alertActions = {
    kickBots: { alert: "bots", record: "kick-bot" },
    deleteWebhooks: { alert: "webhooks", record: "delete-webhook" },
    removePermissions: { alert: "privileges", record: "remove-permissions" },
} as const satisfies Record<AlertAction, { alert: AlertKind; record: string }>
/** Permissions whose gain is reported, by their Permissions names */
export const ALERT_PERMISSIONS = [
    "Administrator",
    "ManageGuild",
    "ManageRoles",
    "ManageChannels",
    "ManageWebhooks",
    "BanMembers",
    "KickMembers",
    "ModerateMembers",
] as const
/** Bots and webhooks staff marked as expected raise no alert */
export const AlertSettings = Schema.Struct({
    invites: Schema.Boolean,
    bots: Schema.Boolean,
    webhooks: Schema.Boolean,
    privileges: Schema.Boolean,
    impersonation: Schema.Boolean,
    kickBots: Schema.Boolean,
    deleteWebhooks: Schema.Boolean,
    removePermissions: Schema.Boolean,
    expectedBotIds: Ids(ALERT_EXPECTED_LIMIT),
    expectedWebhookIds: Ids(ALERT_EXPECTED_LIMIT),
})
export type AlertSettings = typeof AlertSettings.Type
const set = Schema.Struct({ type: Schema.Literal("set"), alert: AlertKind, enabled: Schema.Boolean })
/** Turning an action on needs the server owner or an Administrator, turning it off any alerts manager */
const action = Schema.Struct({ type: Schema.Literal("action"), action: AlertAction, enabled: Schema.Boolean })
const expectedKind = Schema.Literals(["bot", "webhook"]),
    expectedIds = Ids(ALERT_EXPECTED_LIMIT)
/** Marks several bots or webhooks expected at once, or stops expecting them */
const expect = Schema.Struct({
    type: Schema.Literal("expect"),
    kind: expectedKind,
    ids: expectedIds.check(Schema.isMinLength(1)),
    expected: Schema.Boolean,
})
/** The website replaces one whole expected list, which also adds, removes or clears many IDs in one save */
const expectedSet = Schema.Struct({ type: Schema.Literal("expected-set"), kind: expectedKind, ids: expectedIds })
export const AlertsOperation = Schema.Union([set, action, expect])
export type AlertsOperation = typeof AlertsOperation.Type
/** Chat changes carry the server manager's fresh native authority, like sticky messages */
export const AlertsManageRequest = Schema.Struct({
    ...origin,
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    actor: ModerationActor,
    managerAuthorized: Schema.Literal(true),
    operation: AlertsOperation,
})
export type AlertsManageRequest = typeof AlertsManageRequest.Type
export const AlertsGetRequest = Schema.Struct({ serverId: Id })
export type AlertsGetRequest = typeof AlertsGetRequest.Type
export const AlertsResult = Schema.Struct({ settings: AlertSettings })
export type AlertsResult = typeof AlertsResult.Type
/**
 * One invite as the bot last read it. ref is a hash of the code that names the invite for dashboard revocations. code is
 * left out when Fluxer sends a code outside the usual form
 */
export const AlertInvite = Schema.Struct({
    ref: Schema.String.check(Schema.isPattern(/^[a-f0-9]{16}$/)),
    code: Schema.optionalKey(InviteCode),
    channelId: Id,
    inviterId: Schema.NullOr(Id),
    uses: count,
    maxUses: count,
    expiresAt: Schema.NullOr(time),
    createdAt: time,
    temporary: Schema.Boolean,
})
export type AlertInvite = typeof AlertInvite.Type
/** Where a dashboard page of invites starts, counted from the newest invite. Absent means the first page */
const inviteOffset = Schema.optionalKey(count)
const inviteFields = {
    invites: List(AlertInvite, ALERT_INVITE_PAGE).check(
        Schema.makeFilter(
            (invites: AlertInvite[]) => new Set(invites.map((invite) => invite.ref)).size === invites.length,
        ),
    ),
    offset: inviteOffset,
    more: Schema.Boolean,
}
/** The page of up to 100 invites the bot last read for the dashboard, newest first. more reports older invites after it */
export const AlertInviteList = Schema.Struct({ readAt: Millis, ...inviteFields })
export type AlertInviteList = typeof AlertInviteList.Type
/** The invites the bot read after the native work of a dashboard invite job. The backend records them as read when the job was observed */
export const AlertsDashboardContext = Schema.Struct(inviteFields)
export type AlertsDashboardContext = typeof AlertsDashboardContext.Type
/** Invite reads and revocations run natively in the bot, so only dashboard jobs carry them. Each names the page it reads */
export const AlertsDashboardOperation = Schema.Union([
    set,
    action,
    expect,
    expectedSet,
    Schema.Struct({ type: Schema.Literal("invites-refresh"), offset: inviteOffset }),
    Schema.Struct({ type: Schema.Literal("invite-revoke"), ref: AlertInvite.fields.ref, offset: inviteOffset }),
])
export type AlertsDashboardOperation = typeof AlertsDashboardOperation.Type

/**
 * A native action the bot is about to take on an alert. key names the alert's cause, audit:<entry ID> or
 * join:<user ID>:<joined at>, so a redelivered event claims nothing. actorId is who the audit entry names, and
 * permissions the gained permissions a removal takes away
 */
export const AlertsActionClaimRequest = Schema.Struct({
    serverId: Id,
    key: Schema.String.check(Schema.isPattern(/^(audit:\d{1,20}|join:\d{1,20}:[\w.:+-]{1,64})$/)),
    action: AlertAction,
    targetId: Id,
    actorId: Schema.optionalKey(Id),
    permissions: Schema.optionalKey(List(Schema.Literals(ALERT_PERMISSIONS), ALERT_PERMISSIONS.length)),
}).check(
    Schema.makeFilter(
        (v) =>
            v.key.startsWith(v.action === "kickBots" ? `join:${v.targetId}:` : "audit:") &&
            (v.action === "kickBots") === (v.actorId === undefined) &&
            (v.action === "removePermissions") === (v.permissions !== undefined) &&
            (v.permissions === undefined ||
                (v.permissions.length > 0 && new Set(v.permissions).size === v.permissions.length)),
    ),
)
export type AlertsActionClaimRequest = typeof AlertsActionClaimRequest.Type
export const AlertsActionClaimResult = Schema.Struct({ claimed: Schema.Boolean })
export type AlertsActionClaimResult = typeof AlertsActionClaimResult.Type
/** An action's result, recorded once */
export const AlertActionOutcome = Schema.Literals(["succeeded", "failed", "uncertain"])
export type AlertActionOutcome = typeof AlertActionOutcome.Type
export const AlertsActionOutcomeRequest = Schema.Struct({
    serverId: Id,
    key: AlertsActionClaimRequest.fields.key,
    outcome: AlertActionOutcome,
})
export type AlertsActionOutcomeRequest = typeof AlertsActionOutcomeRequest.Type
/** admitted tells the bot a new record waits for delivery */
export const AlertsActionOutcomeResult = Schema.Struct({ recorded: Schema.Boolean, admitted: Schema.Boolean })
export type AlertsActionOutcomeResult = typeof AlertsActionOutcomeResult.Type
/** At startup, actions a stopped process left without an outcome become uncertain */
export const AlertsActionsObserveRequest = Schema.Struct({ serverId: Id })
export type AlertsActionsObserveRequest = typeof AlertsActionsObserveRequest.Type
export const AlertsActionsObserveResult = Schema.Struct({ uncertain: Int(0), admitted: Schema.Boolean })
export type AlertsActionsObserveResult = typeof AlertsActionsObserveResult.Type
