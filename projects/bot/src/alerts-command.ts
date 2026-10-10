import type * as C from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"

export const alertKinds = ["invites", "bots", "webhooks", "privileges", "impersonation"] as const satisfies readonly C.AlertKind[]
export type AlertsCommand = { type: "help" } | { type: "status" } | { type: "set", alerts: C.AlertKind[], enabled: boolean }
    | { type: "expect", kind: "bot" | "webhook", id: string, expected: boolean }
export type InvitesCommand = { type: "help" } | { type: "list", next?: true } | { type: "revoke", ref: string }

export const alertsHelp = [
    "!alerts status: Which alerts are on and the bots and webhooks marked expected",
    "!alerts on|off <alert>|all: Alerts are invites, bots, webhooks, privileges and impersonation. All start off",
    "!alerts expect|unexpect bot|webhook <ID>: An expected bot or webhook raises no alert",
    "Alerts go to the metadata log's security category. Turn on metadata logs and route it with !logs metadata route security",
    "NeonFlux only reports. It never acts on an alert. Server owner, Administrator or Manage Server",
].join("\n")
export const invitesHelp = [
    "!invites list [next]: The server's invites with creator, uses and expiry, newest first",
    "!invites revoke <reference>: Revoke the invite the list names with that reference",
    "References stand for invite codes, which NeonFlux never shows or stores. Server owner, Administrator or Manage Server",
].join("\n")

export function parseAlertsCommand(args: readonly string[]): AlertsCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "status" && args.length === 1) return { type: "status" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if ((verb === "on" || verb === "off") && args.length === 2) {
        const name = args[1]!.toLowerCase(), alert = alertKinds.find(kind => kind === name)
        if (name === "all" || alert) return { type: "set", alerts: alert ? [alert] : [...alertKinds], enabled: verb === "on" }
        return { error: `Alerts are ${alertKinds.join(", ")} or all` }
    }
    if ((verb === "expect" || verb === "unexpect") && args.length === 3 && (args[1] === "bot" || args[1] === "webhook")) {
        const id = commandId(args[2])
        return id ? { type: "expect", kind: args[1], id, expected: verb === "expect" } : { error: "Use the bot's or webhook's ID" }
    }
    return { error: "Check the alerts command syntax. Use !alerts help" }
}

export function parseInvitesCommand(args: readonly string[]): InvitesCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "list" && (args.length === 1 || args.length === 2 && args[1] === "next")) return { type: "list", ...(args[1] ? { next: true } : {}) }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "revoke" && args.length === 2) return /^[a-f0-9]{16}$/i.test(args[1]!) ? { type: "revoke", ref: args[1]!.toLowerCase() } : { error: "Use the 16-character reference !invites list shows" }
    return { error: "Check the invites command syntax. Use !invites help" }
}
