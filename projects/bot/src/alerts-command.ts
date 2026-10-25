import { AlertKind, type AlertAction } from "@neonflux/contracts/alerts"
import { InviteCode } from "@neonflux/contracts/common"
import { Schema } from "effect"
import { commands } from "@neontechspace/fluxerly/effect"
import { argument } from "./command-arguments.ts"

export const alertKinds = AlertKind.literals
/** The action each alert can take, by the alert's name in chat */
export const actionOf = { bots: "kickBots", webhooks: "deleteWebhooks", privileges: "removePermissions" } as const
export const actionNames: Record<AlertAction, string> = {
    kickBots: "kick unexpected bots",
    deleteWebhooks: "delete unexpected webhooks",
    removePermissions: "remove gained permissions",
}
export type AlertsCommand =
    | { type: "help" }
    | { type: "status" }
    | { type: "expected"; next?: true }
    | { type: "set"; alerts: AlertKind[]; enabled: boolean }
    | { type: "action"; action: AlertAction; enabled: boolean }
    | { type: "expect"; kind: "bot" | "webhook"; id: string; expected: boolean }
    | { type: "expect"; kind: "webhook"; name: string; expected: boolean }
export type InvitesCommand = { type: "help" } | { type: "list"; next?: true } | { type: "revoke"; code: string }

export const alertsHelp = [
    "!alerts status: Which alerts are on and how many bots and webhooks are marked expected",
    "!alerts expected [next]: The bots and webhooks marked expected",
    "!alerts on|off <alert>|all: Alerts are invites, bots, webhooks, privileges and impersonation. All start off",
    "!alerts expect|unexpect bot <ID>|webhook <name>: An expected bot or webhook raises no alert",
    "!alerts action bots|webhooks|privileges on|off: Kick unexpected bots, delete unexpected webhooks or remove gained permissions. Turning one on needs the owner or an Administrator",
    "Alerts post in the metadata logs' security category. Send it to a staff-only channel with !logs metadata route security",
    "NeonFlux acts on an alert only where you turn its action on with !alerts action",
].join("\n")
export const invitesHelp = [
    "!invites list [next]: The server's invites with code, creator, uses and expiry, newest first",
    "!invites revoke <code>: Revoke the invite with that code",
].join("\n")

export function parseAlertsCommand(args: readonly string[]): AlertsCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || (verb === "status" && args.length === 1)) return { type: "status" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (verb === "expected" && (args.length === 1 || (args.length === 2 && args[1] === "next")))
        return { type: "expected", ...(args[1] ? { next: true } : {}) }
    if ((verb === "on" || verb === "off") && args.length === 2) {
        const name = args[1]!.toLowerCase(),
            alert = alertKinds.find((kind) => kind === name)
        if (name === "all" || alert)
            return { type: "set", alerts: alert ? [alert] : [...alertKinds], enabled: verb === "on" }
        return { error: `Alerts are ${alertKinds.join(", ")} or all` }
    }
    if (verb === "action" && args.length === 3) {
        const alert = args[1]!.toLowerCase(),
            state = args[2]!.toLowerCase()
        if (Object.hasOwn(actionOf, alert) && (state === "on" || state === "off"))
            return { type: "action", action: actionOf[alert as keyof typeof actionOf], enabled: state === "on" }
        return { error: "Use !alerts action bots|webhooks|privileges on|off" }
    }
    if (
        (verb === "expect" || verb === "unexpect") &&
        args.length >= 3 &&
        (args[1] === "bot" || args[1] === "webhook")
    ) {
        const id =
                args.length === 3
                    ? commands.parseArgument(args[2], args[1] === "bot" ? argument.user : argument.id)
                    : undefined,
            expected = verb === "expect"
        if (id) return { type: "expect", kind: args[1], id, expected }
        // A webhook may also be named, with spaces. Bots that have not joined yet have no name to find
        if (args[1] === "bot") return { error: "Use the bot's mention or ID" }
        return args.some((word) => /^<[@#]/.test(word))
            ? { error: "Use the webhook's name or ID" }
            : { type: "expect", kind: "webhook", name: args.slice(2).join(" "), expected }
    }
    return { error: "Check the alerts command syntax. Use !alerts help" }
}

export function parseInvitesCommand(args: readonly string[]): InvitesCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || (verb === "list" && (args.length === 1 || (args.length === 2 && args[1] === "next"))))
        return { type: "list", ...(args[1] ? { next: true } : {}) }
    if (verb === "help" && args.length === 1) return { type: "help" }
    // A code matches exactly, since codes differ by case
    if (verb === "revoke" && args.length === 2)
        return Schema.is(InviteCode)(args[1]!)
            ? { type: "revoke", code: args[1]! }
            : { error: "Use the invite code !invites list shows" }
    return { error: "Check the invites command syntax. Use !invites help" }
}
