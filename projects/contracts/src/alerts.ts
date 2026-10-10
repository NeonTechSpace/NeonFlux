import { Schema } from "effect"
import { Id, Ids, Int, List, Millis, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"

// Security alerts and invites, see docs/BOT.md#security-alerts-and-invites

// Each server marks at most this many bots and webhooks as expected, and the dashboard keeps at most this many invites
export const ALERT_EXPECTED_LIMIT = 50, ALERT_INVITE_LIMIT = 100
const time = Schema.String.check(Schema.makeFilter((value: string) => value.length <= 64 && Number.isFinite(Date.parse(value))))
const count = Int(0, 2147483647)

/** Security alerts a server can turn on. Every alert starts off */
export const AlertKind = Schema.Literals(["invites", "bots", "webhooks", "privileges", "impersonation"])
export type AlertKind = typeof AlertKind.Type
/** Bots and webhooks staff marked as expected raise no alert */
export const AlertSettings = Schema.Struct({ invites: Schema.Boolean, bots: Schema.Boolean, webhooks: Schema.Boolean, privileges: Schema.Boolean, impersonation: Schema.Boolean,
    expectedBotIds: Ids(ALERT_EXPECTED_LIMIT), expectedWebhookIds: Ids(ALERT_EXPECTED_LIMIT) })
export type AlertSettings = typeof AlertSettings.Type
const set = Schema.Struct({ type: Schema.Literal("set"), alert: AlertKind, enabled: Schema.Boolean })
const expect = Schema.Struct({ type: Schema.Literal("expect"), kind: Schema.Literals(["bot", "webhook"]), id: Id, expected: Schema.Boolean })
export const AlertsOperation = Schema.Union([set, expect])
export type AlertsOperation = typeof AlertsOperation.Type
/** Chat changes carry the server manager's fresh native authority, like sticky messages */
export const AlertsManageRequest = Schema.Struct({ ...origin, serverId: Id, messageId: Id, createdAt: Millis, actor: ModerationActor, managerAuthorized: Schema.Literal(true), operation: AlertsOperation })
export type AlertsManageRequest = typeof AlertsManageRequest.Type
export const AlertsGetRequest = Schema.Struct({ serverId: Id })
export type AlertsGetRequest = typeof AlertsGetRequest.Type
export const AlertsResult = Schema.Struct({ settings: AlertSettings })
export type AlertsResult = typeof AlertsResult.Type
/** One invite as the bot last read it. ref is a hash that names the invite without its code, which grants access and is never stored */
export const AlertInvite = Schema.Struct({ ref: Schema.String.check(Schema.isPattern(/^[a-f0-9]{16}$/)), channelId: Id, inviterId: Schema.NullOr(Id), uses: count, maxUses: count,
    expiresAt: Schema.NullOr(time), createdAt: time, temporary: Schema.Boolean })
export type AlertInvite = typeof AlertInvite.Type
const inviteFields = { invites: List(AlertInvite, ALERT_INVITE_LIMIT).check(Schema.makeFilter((invites: AlertInvite[]) => new Set(invites.map(invite => invite.ref)).size === invites.length)),
    more: Schema.Boolean }
/** The invites the bot last read for the dashboard, at most 100. more reports that the server has more */
export const AlertInviteList = Schema.Struct({ readAt: Millis, ...inviteFields })
export type AlertInviteList = typeof AlertInviteList.Type
/** The invites the bot read after the native work of a dashboard invite job. The backend records them as read when the job was observed */
export const AlertsDashboardContext = Schema.Struct(inviteFields)
export type AlertsDashboardContext = typeof AlertsDashboardContext.Type
/** Invite reads and revocations run natively in the bot, so only dashboard jobs carry them */
export const AlertsDashboardOperation = Schema.Union([set, expect, Schema.Struct({ type: Schema.Literal("invites-refresh") }),
    Schema.Struct({ type: Schema.Literal("invite-revoke"), ref: AlertInvite.fields.ref })])
export type AlertsDashboardOperation = typeof AlertsDashboardOperation.Type
