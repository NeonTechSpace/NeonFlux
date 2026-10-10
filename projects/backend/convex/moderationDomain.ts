import { Schema } from "effect"
import { AutomodRuleInput, AutomodRulePatch, Bits, LOCK_PERMISSIONS, ModerationSettingsPatch, SEND_MESSAGES, UtcTime, type AutomodRule, type ModerationSettings, type StaffClass } from "@neonflux/contracts/moderation"
import { ModerationActor } from "@neonflux/contracts/shared"
import { decode, fail, name } from "./validation.ts"

export { LOCK_PERMISSIONS, SEND_MESSAGES }
export const DAY = 86400000
// Cases and closed appeals are kept for a fixed period
export const RETENTION = 180 * DAY
export const BATCH = 128
/** Permission bits a lock owns. Locks recorded before thread support own only SendMessages */
export const lockMask = (row: { ownedPermissions?: string }) => row.ownedPermissions === undefined ? SEND_MESSAGES : BigInt(row.ownedPermissions) & LOCK_PERMISSIONS
/** Decimal permission bits, such as the posting bits a bot reports holding */
export const permissionBits = (value: unknown): string => decode(Bits, value, "Invalid permission snapshot")
/** A new lock or close owns SendMessages and the thread bits the bot holds, since Fluxer lets a bot stop denying only permissions it holds */
export const ownedPostingBits = (all: bigint, botPostingPermissions: string | undefined) => SEND_MESSAGES | (all & BigInt(botPostingPermissions ?? "0"))
export const defaultSettings = (): ModerationSettings => ({
    manualModerationEnabled: true,
    staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] },
    logChannelId: null, automodEnabled: false, automodMode: "dry-run", automodBotMessagesEnabled: false,
    securityEnabled: false, securityMode: "dry-run", joinEnabled: false, joinThreshold: 10,
    joinWindowSeconds: 10, joinDefcon2: false, honeypotEnabled: false, honeypotChannelIds: [],
    watchlistEnabled: false, appealsEnabled: true, defcon: 3,
})
// Some features read the actor together with other member facts, which they check themselves
const ActorRead = Schema.StructWithRest(ModerationActor, [Schema.Record(Schema.String, Schema.Unknown)])
// Authority booleans are trusted only with the server they were read from. The HTTP boundary matches it to the request
export function actor(value: unknown): ModerationActor {
    const input = decode(ActorRead, value)
    if (input.originServerId === undefined) fail(403, "Native evidence server mismatch")
    return { userId: input.userId, roleIds: [...new Set(input.roleIds)], isOwner: input.isOwner, isAdministrator: input.isAdministrator, nativePermissionAuthorized: input.nativePermissionAuthorized }
}
export function administrator(actor: ModerationActor) { return actor.isOwner || actor.isAdministrator }
export function authorize(actor: ModerationActor, settings: ModerationSettings, scope: StaffClass, critical = false) {
    if (!administrator(actor) && (!actor.nativePermissionAuthorized || !actor.roleIds.some(id => settings.staffRoleIds[scope].includes(id)))) fail(403, "Staff permission required")
    if (settings.defcon === 1 && (!critical || !administrator(actor))) fail(403, "DEFCON restriction")
}
const NullableTime = Schema.NullOr(UtcTime)
export const timeout = (value: unknown): string | null => decode(NullableTime, value, "Invalid timeout snapshot")
export function settingsPatch(current: ModerationSettings, value: unknown): ModerationSettings {
    const { staffRoleIds, honeypotChannelIds, ...patch } = decode(ModerationSettingsPatch, value)
    const next = structuredClone(current)
    return { ...next, ...patch, ...(honeypotChannelIds ? { honeypotChannelIds: [...new Set(honeypotChannelIds)] } : {}),
        staffRoleIds: { ...next.staffRoleIds, ...Object.fromEntries(Object.entries(staffRoleIds ?? {}).map(([scope, list]) => [scope, [...new Set(list)]])) } }
}
export function rule(value: unknown): AutomodRule {
    const input = decode(AutomodRuleInput, value)
    return { ...input, name: name(input.name), patterns: [...new Set(input.patterns.map(p => p.trim().toLowerCase()))],
        channelIds: [...new Set(input.channelIds)], exemptChannelIds: [...new Set(input.exemptChannelIds)], exemptRoleIds: [...new Set(input.exemptRoleIds)] }
}
export function rulePatch(current: AutomodRule, value: unknown) {
    return rule({ ...current, ...decode(AutomodRulePatch, value) })
}
export function domains(content: string): string[] {
    const result: string[] = []
    for (const match of content.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>]+/gi)) {
        try { const raw = match[0].replace(/[),.!?;]+$/, ""); const parsed = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw); result.push(parsed.hostname.toLowerCase().replace(/\.$/, "")) } catch { /* Malformed local text is not a URL */ }
    }
    return result
}
export function domainMatches(hosts: string[], patterns: string[]) { return hosts.some(host => patterns.some(p => host === p || host.endsWith(`.${p}`))) }
