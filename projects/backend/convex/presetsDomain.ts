import type { AutomodRule, ModerationSettings } from "@neonflux/contracts/moderation"
import type { PresetChange, PresetName } from "@neonflux/contracts/presets"
import { fail } from "./validation.ts"

/** The rule fields a preset sets. Other fields of an existing rule of the same name, such as exemptions, stay as they are */
export type PresetRule = Pick<AutomodRule, "name" | "type" | "action" | "threshold" | "windowSeconds" | "durationSeconds">
type ModerationPatch = Partial<Pick<ModerationSettings, "automodEnabled" | "automodMode" | "automodBotMessagesEnabled" | "securityEnabled" | "securityMode" | "joinEnabled" | "joinThreshold" | "joinWindowSeconds" | "joinDefcon2">>
export interface PresetDefinition {
    name: PresetName
    kind: "community" | "security"
    description: string
    moderation?: ModerationPatch
    rules?: PresetRule[]
    leveling?: { enabled: boolean, xpPerMessage?: number, cooldownSeconds?: number }
    tickets?: { enabled: boolean, retentionDays?: number }
    events?: { enabled: boolean }
}
const rule = (name: string, type: AutomodRule["type"], action: AutomodRule["action"], threshold: number, windowSeconds: number): PresetRule =>
    ({ name, type, action, threshold, windowSeconds, durationSeconds: 600 })
// Security levels set the automod and security switches and add or update rules named preset-*. They never touch channels, roles or other rules
export const PRESETS: readonly PresetDefinition[] = [
    { name: "gaming", kind: "community", description: "Leveling with quick XP and events for game nights", leveling: { enabled: true, xpPerMessage: 20, cooldownSeconds: 60 }, events: { enabled: true } },
    { name: "support", kind: "community", description: "Tickets with 90 days of history, without leveling", tickets: { enabled: true, retentionDays: 90 }, leveling: { enabled: false } },
    { name: "creator", kind: "community", description: "Events for streams and releases and slower leveling", events: { enabled: true }, leveling: { enabled: true, xpPerMessage: 10, cooldownSeconds: 120 } },
    { name: "relaxed", kind: "security", description: "Automod deletes spam and lookalike links. Join-burst detection off",
        moderation: { automodEnabled: true, automodMode: "enforce", automodBotMessagesEnabled: false, joinEnabled: false, joinDefcon2: false },
        rules: [rule("preset-spam", "spam", "delete", 8, 10), rule("preset-lookalikes", "deceptive-links", "delete", 1, 1)] },
    { name: "balanced", kind: "security", description: "Automod against spam, repeats and mention floods, and join-burst detection",
        moderation: { automodEnabled: true, automodMode: "enforce", automodBotMessagesEnabled: false, securityEnabled: true, securityMode: "enforce", joinEnabled: true, joinThreshold: 10, joinWindowSeconds: 30, joinDefcon2: false },
        rules: [rule("preset-spam", "spam", "delete", 6, 10), rule("preset-repeat", "repeat", "delete", 4, 30), rule("preset-mentions", "mention-rate", "delete", 15, 30), rule("preset-lookalikes", "deceptive-links", "delete", 1, 1)] },
    { name: "strict", kind: "security", description: "Timeouts for spam and mention floods, link limits, checks on webhook messages and DEFCON 2 on join bursts",
        moderation: { automodEnabled: true, automodMode: "enforce", automodBotMessagesEnabled: true, securityEnabled: true, securityMode: "enforce", joinEnabled: true, joinThreshold: 5, joinWindowSeconds: 30, joinDefcon2: true },
        rules: [rule("preset-spam", "spam", "timeout", 5, 10), rule("preset-repeat", "repeat", "delete", 3, 30), rule("preset-mentions", "mention-rate", "timeout", 10, 30),
            rule("preset-links", "link-rate", "delete", 6, 30), rule("preset-lookalikes", "deceptive-links", "delete", 1, 1)] },
]
export function presetDefinition(value: unknown): PresetDefinition {
    return PRESETS.find(preset => preset.name === value) ?? fail(404, "Unknown preset. Presets are gaming, support, creator, relaxed, balanced and strict")
}

const labels: Record<string, string> = { automodEnabled: "automod", automodMode: "automod mode", automodBotMessagesEnabled: "automod checks webhook and bot messages", securityEnabled: "security",
    securityMode: "security mode", joinEnabled: "join-burst detection", joinThreshold: "join-burst threshold", joinWindowSeconds: "join-burst window seconds", joinDefcon2: "DEFCON 2 on join bursts",
    xpPerMessage: "XP per message", cooldownSeconds: "XP cooldown seconds", retentionDays: "ticket history days" }
export const settingLabel = (family: string, key: string) => key === "enabled" ? family : labels[key] ?? key
export const shown = (value: unknown) => value === undefined ? "none" : typeof value === "boolean" ? value ? "on" : "off" : value === "dry-run" ? "test mode" : value === "enforce" ? "enforcing" : String(value)
/** A rule as a preview shows it, such as "spam, delete at 6 in 10 seconds" */
export function ruleText(value: Pick<AutomodRule, "type" | "action" | "threshold" | "windowSeconds" | "durationSeconds"> & { enabled?: boolean }) {
    const action = value.action === "timeout" ? `timeout of ${value.durationSeconds / 60} minutes` : value.action
    const at = value.type === "deceptive-links" ? "" : ` at ${value.threshold} in ${value.windowSeconds} seconds`
    return `${value.type}, ${action}${at}${value.enabled === false ? ", disabled" : ""}`
}
/** A short code that changes with the preview. It binds a confirmation to what the manager saw, not a secret */
export function previewToken(name: string, changes: PresetChange[]) {
    let hash = 2166136261
    for (const char of JSON.stringify([name, changes])) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
    return hash.toString(16).padStart(8, "0")
}
