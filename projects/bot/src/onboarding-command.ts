import type * as C from "@neonflux/backend/contracts"
import { commandId } from "./moderation-command.ts"

export type OnboardingCommand =
    | { type: "progress" }
    | { type: "help" }
    | { type: "status" }
    | { type: "module", enabled: boolean }
    | { type: "delivery", delivery: "welcome" | "dm" }
    | { type: "add", step: C.OnboardingStep }
    | { type: "remove", position: number }
    | { type: "role", roleId: string | null }

export const onboardingHelp = [
    "!onboarding: Show your newcomer checklist and what is left",
    "!onboarding status | on | off",
    "!onboarding add rules | add panel <name> | add menu <name> | add link #channel \"line\"",
    "!onboarding remove <position> | delivery welcome|dm | role @role|none",
    "Up to 5 steps. The checklist goes with the welcome or DM greeting. Changes need the server owner or an Administrator",
].join("\n")
const usage = "Check the onboarding command syntax. Use !onboarding help"

export function parseOnboardingCommand(args: readonly string[]): OnboardingCommand | { error: string } {
    const verb = args[0]?.toLowerCase(), rest = args.slice(1)
    if (!verb) return { type: "progress" }
    if (rest.length === 0 && (verb === "help" || verb === "status")) return { type: verb }
    if (rest.length === 0 && (verb === "on" || verb === "off")) return { type: "module", enabled: verb === "on" }
    if (verb === "delivery" && rest.length === 1 && (rest[0] === "welcome" || rest[0] === "dm")) return { type: "delivery", delivery: rest[0] }
    if (verb === "remove" && rest.length === 1 && /^[1-5]$/.test(rest[0]!)) return { type: "remove", position: Number(rest[0]) }
    if (verb === "role" && rest.length === 1) {
        const roleId = rest[0]!.toLowerCase() === "none" ? null : commandId(rest[0])
        return roleId === undefined ? { error: "Name the completion role with a mention or ID, or none" } : { type: "role", roleId }
    }
    if (verb === "add") {
        const kind = rest[0]?.toLowerCase()
        if (kind === "rules" && rest.length === 1) return { type: "add", step: { type: "rules" } }
        if ((kind === "panel" || kind === "menu") && rest.length === 2 && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(rest[1]!)) return { type: "add", step: { type: kind, name: rest[1]!.toLowerCase() } }
        const channelId = kind === "link" ? commandId(rest[1]) : undefined
        if (channelId && rest.length >= 3) {
            const text = rest.slice(2).join(" ").trim()
            return text && text.length <= 100 ? { type: "add", step: { type: "link", channelId, text } } : { error: "A link step needs a line of 1 to 100 characters" }
        }
    }
    return { error: usage }
}
/** Members check their own checklist, which works for everyone like other member commands */
export const onboardingPublic = (command: OnboardingCommand | { error: string }) => "error" in command || command.type === "progress" || command.type === "help"
/** Turning the checklist off and reading its status stay available at DEFCON 1, like other role settings */
export const onboardingCritical = (command: OnboardingCommand | { error: string }) => !("error" in command) && (command.type === "status" || command.type === "module" && !command.enabled)
