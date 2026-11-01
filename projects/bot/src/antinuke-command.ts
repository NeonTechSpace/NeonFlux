import { AntiNukeLimitName, AntiNukeResponse, type AntiNukeLimit } from "@neonflux/contracts/anti-nuke"
import {
    ANTI_NUKE_MAX_COUNT,
    ANTI_NUKE_MAX_SECONDS,
    ANTI_NUKE_MIN_COUNT,
    ANTI_NUKE_MIN_SECONDS,
} from "@neonflux/contracts/anti-nuke"
import { commands } from "@neontechspace/fluxerly/effect"
import { argument, wholeNumber } from "./command-arguments.ts"

export type AntiNukeCommand =
    | { type: "help" }
    | { type: "status" }
    | { type: "module" | "lockdown"; enabled: boolean }
    | { type: "mode"; mode: "dry-run" | "enforce" }
    | { type: "limit"; limit: AntiNukeLimitName; value: AntiNukeLimit }
    | { type: "response"; response: AntiNukeResponse }
    | { type: "trust"; userId: string; trusted: boolean }
    | { type: "trust-list"; next?: true }
    | { type: "incidents"; next?: true }
    | { type: "incident"; incidentNo: number }
    | { type: "restore"; userId: string }

export const antinukeHelp = [
    "!antinuke status|module on|off: What anti-nuke does now, or turn it on and off. It starts off and needs View activity log",
    "!antinuke mode dry-run|enforce: Only record and alert, or also act. It starts by only recording",
    "!antinuke limit bans|kicks|channels|roles <count> <seconds>: How much one account may do that fast",
    "!antinuke response strip|kick|ban: What enforce does to an account. Strip takes its dangerous roles, and a bot with none is kicked",
    "!antinuke lockdown on|off: Let an incident start the server-wide lockdown when stopping one account cannot contain it. It starts off",
    "!antinuke trust add|remove @member, !antinuke trust list [next]: Accounts it only alerts about",
    "!antinuke incidents [next], !antinuke incident <number>: What it saw and did, also while logs are off",
    "!antinuke restore @member: Give back the roles an incident removed",
    "It only alerts about the owner, NeonFlux, trusted accounts and anyone ranked at or above NeonFlux, and cannot stop them. Owner or Administrator only",
].join("\n")

const syntax = { error: "Check the anti-nuke command syntax. Use !antinuke help" }
const onOff = (word: string | undefined) => (word === "on" ? true : word === "off" ? false : undefined)
export function parseAntiNukeCommand(args: readonly string[]): AntiNukeCommand | { error: string } {
    const verb = args[0]?.toLowerCase(),
        word = args[1]?.toLowerCase()
    if (!verb || (verb === "status" && args.length === 1)) return { type: "status" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    if ((verb === "module" || verb === "lockdown") && args.length === 2) {
        const enabled = onOff(word)
        return enabled === undefined ? syntax : { type: verb, enabled }
    }
    if (verb === "mode" && args.length === 2 && (word === "dry-run" || word === "enforce"))
        return { type: "mode", mode: word }
    if (verb === "response" && args.length === 2 && AntiNukeResponse.literals.includes(word as AntiNukeResponse))
        return { type: "response", response: word as AntiNukeResponse }
    if (verb === "limit" && args.length === 4 && AntiNukeLimitName.literals.includes(word as AntiNukeLimitName)) {
        const count = wholeNumber(args[2], ANTI_NUKE_MIN_COUNT, ANTI_NUKE_MAX_COUNT),
            seconds = wholeNumber(args[3], ANTI_NUKE_MIN_SECONDS, ANTI_NUKE_MAX_SECONDS)
        return count === undefined || seconds === undefined
            ? {
                  error: `A limit is ${ANTI_NUKE_MIN_COUNT} to ${ANTI_NUKE_MAX_COUNT} actions in ${ANTI_NUKE_MIN_SECONDS} to ${ANTI_NUKE_MAX_SECONDS} seconds`,
              }
            : { type: "limit", limit: word as AntiNukeLimitName, value: { count, seconds } }
    }
    if (verb === "trust") {
        if (word === "list" && (args.length === 2 || (args.length === 3 && args[2] === "next")))
            return { type: "trust-list", ...(args[2] ? { next: true as const } : {}) }
        if ((word === "add" || word === "remove") && args.length === 3) {
            const userId = commands.parseArgument(args[2], argument.user)
            return userId ? { type: "trust", userId, trusted: word === "add" } : syntax
        }
    }
    if (verb === "incidents" && (args.length === 1 || (args.length === 2 && args[1] === "next")))
        return { type: "incidents", ...(args[1] ? { next: true as const } : {}) }
    if (verb === "incident" && args.length === 2) {
        const incidentNo = commands.parseArgument(args[1], argument.positive)
        return incidentNo ? { type: "incident", incidentNo } : syntax
    }
    if (verb === "restore" && args.length === 2) {
        const userId = commands.parseArgument(args[1], argument.user)
        return userId ? { type: "restore", userId } : syntax
    }
    return syntax
}
/** Turning protection down, reading incidents and giving roles back stay reachable for an Administrator at DEFCON 1 */
export function antiNukeCritical(command: AntiNukeCommand | { error: string }) {
    if (!("type" in command)) return false
    return (
        command.type === "status" ||
        command.type === "incidents" ||
        command.type === "incident" ||
        command.type === "restore" ||
        ((command.type === "module" || command.type === "lockdown") && !command.enabled) ||
        (command.type === "mode" && command.mode === "dry-run")
    )
}
