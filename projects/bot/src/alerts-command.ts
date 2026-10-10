import type * as C from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"

export const alertKinds = ["invites", "bots", "webhooks", "privileges", "impersonation"] as const satisfies readonly C.AlertKind[]
export type AlertsCommand = { type: "help" } | { type: "status" } | { type: "expected", next?: true } | { type: "set", alerts: C.AlertKind[], enabled: boolean }
    | { type: "expect", kind: "bot" | "webhook", id: string, expected: boolean } | { type: "expect", kind: "webhook", name: string, expected: boolean }
export type InvitesCommand = { type: "help" } | { type: "list", next?: true } | { type: "revoke", ref: string }

export const alertsHelp = [
    "!alerts status: Which alerts are on and how many bots and webhooks are marked expected",
    "!alerts expected [next]: The bots and webhooks marked expected",
    "!alerts on|off <alert>|all: Alerts are invites, bots, webhooks, privileges and impersonation. All start off",
    "!alerts expect|unexpect bot <ID>|webhook <name>: An expected bot or webhook raises no alert",
    "Alerts post in the metadata logs' security category. Send it to a staff channel with !logs metadata route security",
    "NeonFlux only reports. It never acts on an alert",
].join("\n")
export const invitesHelp = [
    "!invites list [next]: The server's invites with creator, uses and expiry, newest first",
    "!invites revoke <reference>: Revoke the invite the list shows with that reference",
].join("\n")

export function parseAlertsCommand(args: readonly string[]): AlertsCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "status" && args.length === 1) return { type: "status" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "expected" && (args.length === 1 || args.length === 2 && args[1] === "next")) return { type: "expected", ...(args[1] ? { next: true } : {}) }
    if ((verb === "on" || verb === "off") && args.length === 2) {
        const name = args[1]!.toLowerCase(), alert = alertKinds.find(kind => kind === name)
        if (name === "all" || alert) return { type: "set", alerts: alert ? [alert] : [...alertKinds], enabled: verb === "on" }
        return { error: `Alerts are ${alertKinds.join(", ")} or all` }
    }
    if ((verb === "expect" || verb === "unexpect") && args.length >= 3 && (args[1] === "bot" || args[1] === "webhook")) {
        const id = args.length === 3 ? commandId(args[2]) : undefined, expected = verb === "expect"
        if (id) return { type: "expect", kind: args[1], id, expected }
        // A webhook may also be named, with spaces. Bots that have not joined yet have no name to find
        if (args[1] === "bot") return { error: "Use the bot's mention or ID" }
        return args.some(word => /^<[@#]/.test(word)) ? { error: "Use the webhook's name or ID" } : { type: "expect", kind: "webhook", name: args.slice(2).join(" "), expected }
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
