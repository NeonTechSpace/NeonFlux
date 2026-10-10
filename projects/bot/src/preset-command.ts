import type { PresetName } from "@neonflux/contracts/presets"
import { presetNames } from "./preset-store.ts"

/** show counts a preset's changes. all lists each one, ten to a page with next */
export type PresetCommand = { type: "help" } | { type: "list" } | { type: "show", name: PresetName, all?: true, next?: true } | { type: "apply", name: PresetName, token?: string }

export const presetHelp = [
    "!preset list: The starting setups NeonFlux offers",
    "!preset show <name> [all]: How much a preset would change now, and the code that confirms it. all lists each change",
    "!preset apply <name> <code>: Apply the changes you saw",
    "Community presets: gaming, support, creator. Security levels: relaxed, balanced, strict",
    "A preset never deletes anything or changes channels or roles",
].join("\n")

const presetName = (value: string | undefined) => presetNames.find(name => name === value?.toLowerCase())
export function parsePresetCommand(args: readonly string[]): PresetCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "list" && args.length === 1) return { type: "list" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    const name = presetName(args[1])
    if ((verb === "show" || verb === "apply") && args.length >= 2 && !name) return { error: `Unknown preset. Choose one of ${presetNames.join(", ")}` }
    if (verb === "show" && name && args.length === 2) return { type: "show", name }
    if (verb === "show" && name && args[2]?.toLowerCase() === "all" && (args.length === 3 || args.length === 4 && args[3]!.toLowerCase() === "next")) return { type: "show", name, all: true, ...(args.length === 4 ? { next: true } : {}) }
    if (verb === "apply" && name && args.length === 2) return { type: "apply", name }
    if (verb === "apply" && name && args.length === 3 && /^[a-f0-9]{8}$/i.test(args[2]!)) return { type: "apply", name, token: args[2]!.toLowerCase() }
    return { error: "Check the preset command syntax. Use !preset help" }
}
