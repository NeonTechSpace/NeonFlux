import { ONBOARDING_STEPS, ONBOARDING_TEXT, type OnboardingStep } from "@neonflux/contracts/onboarding"
import { isName } from "@neonflux/contracts/common"
import { commands } from "@neontechspace/fluxerly/effect"
import { argument } from "./command-arguments.ts"

export type OnboardingCommand =
    | { type: "progress" }
    | { type: "help" }
    | { type: "status" }
    | { type: "module"; enabled: boolean }
    | { type: "delivery"; delivery: "welcome" | "dm" }
    | { type: "add"; step: OnboardingStep }
    | { type: "remove"; position: number }
    | { type: "role"; roleId: string | null }

export const onboardingHelp = [
    "!onboarding: Your newcomer checklist and what is left",
    "!onboarding status: The checklist as staff set it up",
    "!onboarding on|off: Turn the checklist on or off",
    `!onboarding add rules | add panel <name> | add menu <name>: Add a step, up to ${ONBOARDING_STEPS}`,
    '!onboarding add link #channel "line": Add a channel to visit as a step',
    "!onboarding remove <position>: Remove a step",
    "!onboarding delivery welcome|dm: Send it with the welcome message or the DM greeting",
    "!onboarding role @role|none: A role members get once they finish",
].join("\n")
const usage = "Check the onboarding command syntax. Use !onboarding help"

export function parseOnboardingCommand(args: readonly string[]): OnboardingCommand | { error: string } {
    const verb = args[0]?.toLowerCase(),
        rest = args.slice(1)
    if (!verb) return { type: "progress" }
    if (rest.length === 0 && (verb === "help" || verb === "status")) return { type: verb }
    if (rest.length === 0 && (verb === "on" || verb === "off")) return { type: "module", enabled: verb === "on" }
    if (verb === "delivery" && rest.length === 1 && (rest[0] === "welcome" || rest[0] === "dm"))
        return { type: "delivery", delivery: rest[0] }
    const position =
        verb === "remove"
            ? commands.parseArgument(rest[0], { type: "integer", min: 1, max: ONBOARDING_STEPS })
            : undefined
    if (rest.length === 1 && position) return { type: "remove", position }
    if (verb === "role" && rest.length === 1) {
        const roleId = rest[0]!.toLowerCase() === "none" ? null : commands.parseArgument(rest[0], argument.role)
        return roleId === undefined
            ? { error: "Name the completion role with a mention or ID, or none" }
            : { type: "role", roleId }
    }
    if (verb === "add") {
        const kind = rest[0]?.toLowerCase()
        if (kind === "rules" && rest.length === 1) return { type: "add", step: { type: "rules" } }
        if ((kind === "panel" || kind === "menu") && rest.length === 2 && isName(rest[1]!.toLowerCase()))
            return { type: "add", step: { type: kind, name: rest[1]!.toLowerCase() } }
        const channelId = kind === "link" ? commands.parseArgument(rest[1], argument.channel) : undefined
        if (channelId && rest.length >= 3) {
            const text = rest.slice(2).join(" ").trim()
            return text && text.length <= ONBOARDING_TEXT
                ? { type: "add", step: { type: "link", channelId, text } }
                : { error: `A link step needs a line of 1 to ${ONBOARDING_TEXT} characters` }
        }
    }
    return { error: usage }
}
/** Members check their own checklist, which works for everyone like other member commands */
export const onboardingPublic = (command: OnboardingCommand | { error: string }) =>
    "error" in command || command.type === "progress" || command.type === "help"
/** Turning the checklist off and reading its status stay available at DEFCON 1, like other role settings */
export const onboardingCritical = (command: OnboardingCommand | { error: string }) =>
    !("error" in command) && (command.type === "status" || (command.type === "module" && !command.enabled))
