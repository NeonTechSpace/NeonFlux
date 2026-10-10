import type * as C from "@neonflux/backend/contracts"
import { presetNames } from "./preset-store.ts"

export type PresetCommand = { type: "help" } | { type: "list" } | { type: "show", name: C.PresetName } | { type: "apply", name: C.PresetName, token?: string }

export const presetHelp = [
    "!preset list: The starting configurations NeonFlux offers",
    "!preset show <name>: Exactly which settings the preset would change now",
    "!preset apply <name>: Show the changes and the code that confirms them, then !preset apply <name> <code>",
    "Community presets: gaming, support, creator. Security levels: relaxed, balanced, strict",
    "A preset only changes the settings it names and adds or updates its own automod rules. It deletes nothing and never changes channels or roles",
    "Previews need Manage Server. Applying needs the server owner or an Administrator",
].join("\n")

const presetName = (value: string | undefined) => presetNames.find(name => name === value?.toLowerCase())
export function parsePresetCommand(args: readonly string[]): PresetCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "list" && args.length === 1) return { type: "list" }
    if (verb === "help" && args.length === 1) return { type: "help" }
    const name = presetName(args[1])
    if ((verb === "show" || verb === "apply") && args.length >= 2 && !name) return { error: `Unknown preset. Choose one of ${presetNames.join(", ")}` }
    if (verb === "show" && name && args.length === 2) return { type: "show", name }
    if (verb === "apply" && name && args.length === 2) return { type: "apply", name }
    if (verb === "apply" && name && args.length === 3 && /^[a-f0-9]{8}$/i.test(args[2]!)) return { type: "apply", name, token: args[2]!.toLowerCase() }
    return { error: "Check the preset command syntax. Use !preset help" }
}
