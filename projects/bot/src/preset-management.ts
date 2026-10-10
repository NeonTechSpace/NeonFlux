import type * as C from "@neonflux/backend/contracts"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { SafetyPermissionError } from "./safety-permissions.ts"
import { presetHelp, type PresetCommand } from "./preset-command.ts"
import { PresetStoreError, type PresetStore } from "./preset-store.ts"

const changeLine = (change: C.PresetChange) => `${change.setting}: ${change.from} → ${change.to}`
/** A preset's preview with the code that confirms it, or that it changes nothing */
export function formatPresetPlan(plan: C.PresetPlan) {
    const title = `${plan.name} (${plan.kind === "security" ? "security level" : "community"}): ${plan.description}`
    if (!plan.changes.length) return `${title}\nThis server already matches it, so applying it changes nothing`
    return [title, `Changes ${plan.changes.length}:`, ...plan.changes.map(change => `- ${changeLine(change)}`), `Confirm with !preset apply ${plan.name} ${plan.token}`].join("\n")
}
function describe(error: unknown) {
    if (error instanceof PresetStoreError) {
        if (error.status === 409) return "Settings changed since this preview, or a change on the website came later. Run !preset show again and confirm its new code"
        if (error.status === 403) return "Only the server owner or an Administrator can apply a preset, and not at DEFCON 1"
        if (error.status === 429) return "This server has the most automod rules it can hold. Delete one with !automod delete <name> first"
        return "Presets are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    return "The preset command could not be completed"
}

export function handlePresetCommand(store: PresetStore | undefined, config: BotConfig, command: PresetCommand | { error: string }, context: BotEventContext<"messageCreate">) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => Effect.gen(function* () {
        for (let index = 0; index < content.length; index += 1900) yield* context.reply({ content: withPrefix(content.slice(index, index + 1900), prefix), allowedMentions: noMentions })
    })
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store) { yield* reply("Preset persistence is not configured"); return }
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(presetHelp); return }
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id)
        if (!manager) { yield* reply("Only the server owner or members with Manage Server can preview presets"); return }
        if (command.type === "apply" && command.token) {
            if (!authority.isOwner && !authority.isAdmin) { yield* reply("Only the server owner or an Administrator can apply a preset"); return }
            const applied = yield* store.apply({ serverId, originServerId: authority.guild.id, messageId: message.id, createdAt: yield* sourceTimestamp(message), actor, name: command.name, token: command.token })
            yield* reply(applied.plan.changes.length ? [`Applied ${applied.plan.name}`, ...applied.plan.changes.map(changeLine)].join("\n") : `${applied.plan.name} changed nothing`)
            return
        }
        const { presets } = yield* store.plans({ serverId })
        if (command.type === "list") {
            yield* reply(["Presets. Show one with !preset show <name>", ...presets.map(plan => `${plan.name} (${plan.kind === "security" ? "security level" : "community"}): ${plan.description}. ${plan.changes.length ? `${plan.changes.length} changes` : "Already matches"}`)].join("\n"))
            return
        }
        const plan = presets.find(row => row.name === command.name)
        if (plan) yield* reply(formatPresetPlan(plan))
    }).pipe(Effect.catch(error => reply(describe(error))), Effect.asVoid)
}
