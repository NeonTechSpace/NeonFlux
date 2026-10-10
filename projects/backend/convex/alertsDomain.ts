import {
    AlertKind,
    AlertsDashboardContext,
    AlertsDashboardOperation,
    type AlertInviteList,
    type AlertSettings,
} from "@neonflux/contracts/alerts"
import { decode } from "./validation.ts"

export const alertKinds = AlertKind.literals
export const defaultAlertSettings = (): AlertSettings => ({
    invites: false,
    bots: false,
    webhooks: false,
    privileges: false,
    impersonation: false,
    expectedBotIds: [],
    expectedWebhookIds: [],
})

// Invite reads and revocations run natively in the bot, so only dashboard jobs carry them
export const alertsOperation = (value: unknown): AlertsDashboardOperation => decode(AlertsDashboardOperation, value)

/** The invite list the bot read for a dashboard job. It holds no invite codes */
export const alertInviteList = (value: unknown, readAt: number): AlertInviteList => ({
    readAt,
    ...decode(AlertsDashboardContext, value),
})
