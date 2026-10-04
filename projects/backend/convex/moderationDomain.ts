import type { AutomodRule, ModerationActor, ModerationSettings, PermissionOverwriteSnapshot, StaffClass } from "../contracts.js"
import { bool, fail, ids, integer, name, object, requireId, text } from "./validation.ts"

export const DAY = 86400000
// Cases and closed appeals are kept for a fixed period
export const RETENTION = 180 * DAY
export const BATCH = 128
export const SEND_MESSAGES = 2048n
export const staffClasses: StaffClass[] = ["moderation", "cases", "automod", "security", "appeals"]
export const defaultSettings = (): ModerationSettings => ({
    manualModerationEnabled: true,
    staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] },
    logChannelId: null, automodEnabled: false, automodMode: "dry-run",
    securityEnabled: false, securityMode: "dry-run", joinEnabled: false, joinThreshold: 10,
    joinWindowSeconds: 10, joinDefcon2: false, honeypotEnabled: false, honeypotChannelIds: [],
    watchlistEnabled: false, appealsEnabled: true, defcon: 3,
})
export function actor(value: unknown): ModerationActor {
    const input = object(value)
    return { userId: requireId(input.userId), roleIds: ids(input.roleIds, 1000), isOwner: bool(input.isOwner),
        isAdministrator: bool(input.isAdministrator), nativePermissionAuthorized: bool(input.nativePermissionAuthorized) }
}
export function administrator(actor: ModerationActor) { return actor.isOwner || actor.isAdministrator }
export function authorize(actor: ModerationActor, settings: ModerationSettings, scope: StaffClass, critical = false) {
    if (!administrator(actor) && (!actor.nativePermissionAuthorized || !actor.roleIds.some(id => settings.staffRoleIds[scope].includes(id)))) fail(403, "Staff permission required")
    if (settings.defcon === 1 && (!critical || !administrator(actor))) fail(403, "DEFCON restriction")
}
export function overwrite(value: unknown): PermissionOverwriteSnapshot {
    const input = object(value); const exists = bool(input.exists)
    for (const field of ["allow", "deny"] as const) {
        if (typeof input[field] !== "string" || !/^(0|[1-9]\d{0,18})$/.test(input[field]) || BigInt(input[field]) > 9223372036854775807n) fail(400, "Invalid permission snapshot")
    }
    if (!exists && (input.allow !== "0" || input.deny !== "0")) fail(400, "Invalid permission snapshot")
    return { exists, allow: input.allow as string, deny: input.deny as string }
}
export function timeout(value: unknown): string | null {
    if (value === null) return null
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(400, "Invalid timeout snapshot")
    return value
}
export function settingsPatch(current: ModerationSettings, value: unknown): ModerationSettings {
    const input = object(value); const next: ModerationSettings = structuredClone(current)
    if (!Object.keys(input).length) fail(400, "Invalid request")
    for (const [key, value] of Object.entries(input)) {
        if (!Object.hasOwn(current, key)) fail(400, "Invalid request")
        if (key === "staffRoleIds") {
            const roles = object(value)
            for (const [scope, list] of Object.entries(roles)) { if (!staffClasses.includes(scope as StaffClass)) fail(400, "Invalid request"); next.staffRoleIds[scope as StaffClass] = ids(list) }
        } else if (key === "logChannelId") next.logChannelId = value === null ? null : requireId(value)
        else if (key === "defcon") next.defcon = integer(value, 1, 3) as 1 | 2 | 3
        else if (key === "joinThreshold") next.joinThreshold = integer(value, 2, 100)
        else if (key === "joinWindowSeconds") next.joinWindowSeconds = integer(value, 1, 300)
        else if (key === "honeypotChannelIds") next.honeypotChannelIds = ids(value)
        else if (key === "automodMode" || key === "securityMode") { if (value !== "dry-run" && value !== "enforce") fail(400, "Invalid request"); next[key] = value }
        else (next as unknown as Record<string, unknown>)[key] = bool(value)
    }
    return next
}
export function rule(value: unknown): AutomodRule {
    const input = object(value)
    if (!["spam", "repeat", "mentions", "words", "domains", "invites"].includes(String(input.type)) || !["log", "delete", "warn", "timeout"].includes(String(input.action))) fail(400, "Invalid request")
    if (!Array.isArray(input.patterns) || input.patterns.length > 20) fail(400, "Invalid request")
    const patterns = [...new Set(input.patterns.map(p => text(p, 200).trim().toLowerCase()))]
    if (["words", "domains", "invites"].includes(String(input.type)) && !patterns.length) fail(400, "Patterns required")
    if (input.type === "domains" && patterns.some(p => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(p))) fail(400, "Invalid domain")
    if (input.domainMode !== "block" && input.domainMode !== "allow") fail(400, "Invalid request")
    return { name: name(input.name), type: input.type as AutomodRule["type"], enabled: bool(input.enabled),
        priority: integer(input.priority, -100, 100), action: input.action as AutomodRule["action"], threshold: integer(input.threshold, 1, 100),
        windowSeconds: integer(input.windowSeconds, 1, 300), durationSeconds: integer(input.durationSeconds, 1, 31536000),
        patterns, domainMode: input.domainMode, channelIds: ids(input.channelIds), exemptChannelIds: ids(input.exemptChannelIds), exemptRoleIds: ids(input.exemptRoleIds) }
}
export function rulePatch(current: AutomodRule, value: unknown) {
    const patch = object(value)
    if (!Object.keys(patch).length || Object.keys(patch).some(key => key === "name" || key === "type" || !Object.hasOwn(current, key))) fail(400, "Invalid request")
    return rule({ ...current, ...patch })
}
export function domains(content: string): string[] {
    const result: string[] = []
    for (const match of content.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>]+/gi)) {
        try { const raw = match[0].replace(/[),.!?;]+$/, ""); const parsed = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw); result.push(parsed.hostname.toLowerCase().replace(/\.$/, "")) } catch { /* Malformed local text is not a URL */ }
    }
    return result
}
export function domainMatches(hosts: string[], patterns: string[]) { return hosts.some(host => patterns.some(p => host === p || host.endsWith(`.${p}`))) }
