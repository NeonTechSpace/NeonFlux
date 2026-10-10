import { Schema } from "effect"
import { Id, Int, Millis, Text, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"

// The dashboard link in the server sidebar, see docs/BOT.md#dashboard-link-in-the-server-sidebar

// Fluxer removes U+000C and U+202E and trims names before its own 1 to 100 code unit check. The backend trims them
const name = Text(100)
const set = Schema.Struct({ type: Schema.Literal("set"), name }), remove = Schema.Struct({ type: Schema.Literal("remove") })

/** The link channel that opens this server's dashboard page from the server sidebar. Its name and URL live in Fluxer */
export const SidebarLink = Schema.Struct({ channelId: Id, revision: Int(1), updatedAt: Millis })
export type SidebarLink = typeof SidebarLink.Type
/** The bot creates, renames or deletes the link channel and records it here. Names are validated, never stored */
export const SidebarOperation = Schema.Union([Schema.Struct({ type: Schema.Literal("add"), channelId: Id, name }), set, remove])
export type SidebarOperation = typeof SidebarOperation.Type
export const SidebarManageRequest = Schema.Struct({ ...origin, serverId: Id, messageId: Id, createdAt: Millis, actor: ModerationActor, managerAuthorized: Schema.Literal(true), operation: SidebarOperation })
export type SidebarManageRequest = typeof SidebarManageRequest.Type
export const SidebarGetRequest = Schema.Struct({ serverId: Id })
export type SidebarGetRequest = typeof SidebarGetRequest.Type
export const SidebarResult = Schema.Struct({ link: Schema.NullOr(SidebarLink) })
export type SidebarResult = typeof SidebarResult.Type
/** The link channel the bot created for a dashboard request, in the configured server */
export const SidebarDashboardContext = Schema.Struct({ ...origin, channelId: Id })
export type SidebarDashboardContext = typeof SidebarDashboardContext.Type
/** A dashboard add names the category instead of a channel, because the bot creates the channel when it applies the request */
export const SidebarDashboardOperation = Schema.Union([Schema.Struct({ type: Schema.Literal("add"), name, categoryId: Schema.NullOr(Id) }), set, remove])
export type SidebarDashboardOperation = typeof SidebarDashboardOperation.Type
