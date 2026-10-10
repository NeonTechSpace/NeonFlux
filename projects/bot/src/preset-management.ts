import type { PresetChange, PresetPlan } from "@neonflux/contracts/presets"
import type { BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { sourceTimestamp } from "./responses.ts"
import { code, notSetUp, replyCard, replyText, type Card } from "./reply-style.ts"
import { SafetyPermissionError } from "./safety-permissions.ts"
import { presetHelp, type PresetCommand } from "./preset-command.ts"
import { PresetStoreError, type PresetStore } from "./preset-store.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"

// The backend names a preset's own automod rule changes "rule <name>", from none when the rule is new
const rule = (change: PresetChange) => change.family === "moderation" && change.setting.startsWith("rule ")
const capital = (text: string) => text.replace(/^./, letter => letter.toUpperCase())
const changeLine = (change: PresetChange) => !rule(change) ? `${capital(change.setting)}: ${change.from} → ${change.to}`
    : change.from === "none" ? `Adds automod rule ${change.setting.slice(5)}: ${change.to}` : `Automod rule ${change.setting.slice(5)}: ${change.from} → ${change.to}`
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
/** A preset's changes as one sentence, such as changes 8 settings and adds 5 automod rules, in the present or past tense */
function changeSummary(changes: readonly PresetChange[], done = false) {
    const added = changes.filter(change => rule(change) && change.from === "none").length, updated = changes.filter(rule).length - added, settings = changes.length - added - updated
    const parts = [...settings ? [`${done ? "changed" : "changes"} ${plural(settings, "setting")}`] : [], ...added ? [`${done ? "added" : "adds"} ${plural(added, "automod rule")}`] : [],
        ...updated ? [`${done ? "updated" : "updates"} ${plural(updated, "automod rule")}`] : []]
    return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? ""
}
const PRESET_PAGE = 10
const kind = (plan: PresetPlan) => plan.kind === "security" ? "Security level" : "Community"
const confirm = (plan: PresetPlan, prefix: string) => code(`${prefix}preset apply ${plan.name} ${plan.token}`)
/** A preset's preview: How much it changes and the code that confirms it, or that it changes nothing */
const planCard = (plan: PresetPlan, prefix: string): Card => ({ title: `Preset ${plan.name}`, description: plan.description, fields: [["Kind", kind(plan)],
    ...plan.changes.length ? [["Changes", capital(changeSummary(plan.changes))] as const, ["Confirm", confirm(plan, prefix)] as const] : [["Changes", "None. This server already matches it"] as const]],
    ...(plan.changes.length ? { note: `${code(`${prefix}preset show ${plan.name} all`)} lists each change` } : {}) })
function describe(error: unknown) {
    if (error instanceof PresetStoreError) {
        if (error.status === 409) return "Settings changed since this preview, or a change on the website came later. Run `!preset show <name>` again and confirm its new code"
        if (error.status === 403) return "Only the server owner or an Administrator can apply a preset, and not at DEFCON 1"
        if (error.status === 429) return "This server has the most automod rules it can hold. Delete one with `!automod delete <name>` first"
        return "Presets are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    return "The preset command could not be completed"
}

export function handlePresetCommand(store: PresetStore | undefined, config: BotConfig, command: PresetCommand | { error: string }, context: BotEventContext<"messageCreate">) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, withPrefix(content, prefix)), card = (value: Card) => replyCard(context, config.serverId, value)
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store) { yield* reply(notSetUp("Presets")); return }
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(presetHelp); return }
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id)
        if (!manager) { yield* reply("Only the server owner or members with Manage Server can preview presets"); return }
        if (command.type === "apply" && command.token) {
            if (!authority.isOwner && !authority.isAdmin) { yield* reply("Only the server owner or an Administrator can apply a preset"); return }
            const applied = yield* store.apply({ serverId, originServerId: authority.guild.id, messageId: message.id, createdAt: yield* sourceTimestamp(message), actor, name: command.name, token: command.token })
            yield* reply(applied.plan.changes.length ? `Applied ${applied.plan.name}. It ${changeSummary(applied.plan.changes, true)}` : `${applied.plan.name} changed nothing`)
            return
        }
        const { presets } = yield* store.plans({ serverId })
        if (command.type === "list") {
            yield* card({ title: "Presets", description: presets.map(plan => `**${plan.name}** (${kind(plan).toLowerCase()}): ${plan.description}. ${plan.changes.length ? `${plan.changes.length} change${plan.changes.length === 1 ? "" : "s"}` : "Already matches"}`).join("\n"),
                fields: [["Details", code(`${prefix}preset show <name>`)]] })
            return
        }
        const plan = presets.find(row => row.name === command.name)
        if (!plan) return
        if (command.type === "show" && command.all) {
            // Each change, ten to a page, with the code that confirms them all
            const key = pageKey(serverId, message, "preset", plan.name), start = command.next ? nextPosition<number>(key) : 0
            if (start === undefined) { yield* reply(noNextPage(`!preset show ${plan.name} all`)); return }
            const next = start + PRESET_PAGE < plan.changes.length ? start + PRESET_PAGE : undefined
            yield* card({ title: `Preset ${plan.name} changes`, description: plan.changes.slice(start, start + PRESET_PAGE).map(changeLine).join("\n") || "None. This server already matches it",
                fields: next === undefined ? [] : [["Next", code(`${prefix}preset show ${plan.name} all next`)]], ...(plan.changes.length ? { note: `Confirm with ${confirm(plan, prefix)}` } : {}) })
            rememberPosition(key, next)
            return
        }
        yield* card(planCard(plan, prefix))
    }).pipe(Effect.catch(error => reply(describe(error))), Effect.asVoid)
}
