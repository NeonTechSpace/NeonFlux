import { Schema } from "effect"
import {
    AutomodRuleInput,
    AutomodRulePatch,
    LOCK_PERMISSIONS,
    ModerationSettingsPatch,
    SEND_MESSAGES,
    moderationGate,
    type AutomodRule,
    type ModerationGateRequest,
    type ModerationSettings,
    type StaffClass,
} from "@neonflux/contracts/moderation"
import { ModerationActor } from "@neonflux/contracts/shared"
import { decode, fail, name } from "./validation.ts"

export { LOCK_PERMISSIONS, SEND_MESSAGES }
export const DAY = 86400000
/** The expiry of a case or closed appeal the server keeps until erased, which never enters the retention range */
export const KEEP = Number.MAX_SAFE_INTEGER
/** When a case created or an appeal closed at from expires under the server's case retention */
export const retentionUntil = (settings: Pick<ModerationSettings, "caseRetentionDays">, from: number) =>
    settings.caseRetentionDays ? from + settings.caseRetentionDays * DAY : KEEP
export const BATCH = 128
// Corrections one erasure or retention pass deletes. A case may have any number, so the rest continue in the next run
export const CORRECTION_BATCH = 1024
/** The patterns all of a server's automod rules hold together, and one rule holds, as Discord AutoMod allows */
export const SERVER_PATTERNS = 2000
const RULE_PATTERNS = 1000
/** Permission bits a lock owns, as every lock recovery stores them */
export const lockMask = (row: { ownedPermissions?: string }) => BigInt(row.ownedPermissions!) & LOCK_PERMISSIONS
/** A lock or close owns SendMessages and the thread bits the bot holds, since Fluxer lets a bot stop denying only permissions it holds */
export const ownedPostingBits = (all: bigint, botPostingPermissions: string | undefined) =>
    SEND_MESSAGES | (all & BigInt(botPostingPermissions ?? "0"))
export const defaultSettings = (): ModerationSettings => ({
    manualModerationEnabled: true,
    staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] },
    logChannelId: null,
    automodEnabled: false,
    automodMode: "dry-run",
    automodBotMessagesEnabled: false,
    securityEnabled: false,
    securityMode: "dry-run",
    joinEnabled: false,
    joinThreshold: 10,
    joinWindowSeconds: 10,
    joinDefcon2: false,
    honeypotEnabled: false,
    honeypotChannelIds: [],
    watchlistEnabled: false,
    appealsEnabled: true,
    defcon: 3,
})
// Some features read the actor together with other member facts, which they check themselves
const ActorRead = Schema.StructWithRest(ModerationActor, [Schema.Record(Schema.String, Schema.Unknown)])
// Authority booleans are trusted only with the server they were read from. The HTTP boundary matches it to the request
export function actor(value: unknown): ModerationActor {
    const input = decode(ActorRead, value)
    if (input.originServerId === undefined) fail(403, "Native evidence server mismatch")
    return {
        userId: input.userId,
        roleIds: [...new Set(input.roleIds)],
        isOwner: input.isOwner,
        isAdministrator: input.isAdministrator,
        nativePermissionAuthorized: input.nativePermissionAuthorized,
    }
}
export function administrator(actor: ModerationActor) {
    return actor.isOwner || actor.isAdministrator
}
/** Whether this actor is an administrator or holds a role of any staff class. Staff roles count only with native permission evidence */
export function anyStaff(who: ModerationActor, settings: ModerationSettings) {
    return (
        administrator(who) ||
        (who.nativePermissionAuthorized &&
            Object.values(settings.staffRoleIds).some((ids) => ids.some((id) => who.roleIds.includes(id))))
    )
}
/** The gate for a command from this actor */
export function gateFor(settings: ModerationSettings, value: unknown, command: ModerationGateRequest["command"]) {
    const who = actor(value)
    return moderationGate(settings, command, anyStaff(who, settings), administrator(who))
}
export function authorize(actor: ModerationActor, settings: ModerationSettings, scope: StaffClass, critical = false) {
    if (
        !administrator(actor) &&
        (!actor.nativePermissionAuthorized || !actor.roleIds.some((id) => settings.staffRoleIds[scope].includes(id)))
    )
        fail(403, "Staff permission required")
    if (settings.defcon === 1 && (!critical || !administrator(actor))) fail(403, "DEFCON restriction")
}
export function settingsPatch(current: ModerationSettings, value: unknown): ModerationSettings {
    const { staffRoleIds, honeypotChannelIds, ...patch } = decode(ModerationSettingsPatch, value)
    const next = structuredClone(current)
    return {
        ...next,
        ...patch,
        ...(honeypotChannelIds ? { honeypotChannelIds: [...new Set(honeypotChannelIds)] } : {}),
        staffRoleIds: {
            ...next.staffRoleIds,
            ...Object.fromEntries(
                Object.entries(staffRoleIds ?? {}).map(([scope, list]) => [scope, [...new Set(list)]]),
            ),
        },
    }
}
export function rule(value: unknown): AutomodRule {
    const input = decode(AutomodRuleInput, value)
    const patterns = [...new Set(input.patterns.map((p) => p.trim().toLowerCase()))]
    // A words pattern of only its * marks has no text to match, so it would never catch anything
    if (input.type === "words" && patterns.some((pattern) => pattern === "*" || pattern === "**"))
        fail(400, "A words pattern needs text besides its * marks", "REFUSED")
    return {
        ...input,
        name: name(input.name),
        patterns,
        channelIds: [...new Set(input.channelIds)],
        exemptChannelIds: [...new Set(input.exemptChannelIds)],
        exemptRoleIds: [...new Set(input.exemptRoleIds)],
    }
}
const patternKey = (pattern: string) => pattern.trim().toLowerCase()
/** A rule with a patch applied. Added patterns join the list, then removed ones leave it, so a list grows across commands without reading it first */
export function rulePatch(current: AutomodRule, value: unknown) {
    const { addPatterns, removePatterns, ...patch } = decode(AutomodRulePatch, value)
    const next = { ...current, ...patch }
    if (addPatterns || removePatterns) {
        const removed = new Set((removePatterns ?? []).map(patternKey))
        next.patterns = [...new Set([...next.patterns, ...(addPatterns ?? [])].map(patternKey))].filter(
            (pattern) => !removed.has(pattern),
        )
        if (next.patterns.length > RULE_PATTERNS)
            fail(429, `An automod rule holds at most ${RULE_PATTERNS} patterns`, "REFUSED")
    }
    return rule(next)
}
// Letters, digits, marks and _ make up a word, as \w does in scripts written with spaces
const wordCharacter = /^[\p{L}\p{N}\p{M}_]$/u
// Scripts written without spaces between words, where a word's edge cannot be seen in the text
const unspaced =
    /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]$/u
/** Whether a character continues a word across an edge. The text's end, punctuation and characters of unspaced scripts never do */
const joins = (character: string) => character !== "" && wordCharacter.test(character) && !unspaced.test(character)
/** Text as words patterns compare it: Compatibility forms such as fullwidth letters folded, and lowercase */
export const foldWords = (text: string) => text.normalize("NFKC").toLowerCase()
const before = (text: string, at: number) => {
    const code = text.charCodeAt(at - 1)
    return at >= 2 && code >= 0xdc00 && code <= 0xdfff ? text.slice(at - 2, at) : text.slice(at - 1, at)
}
const after = (text: string, at: number) => (at < text.length ? String.fromCodePoint(text.codePointAt(at)!) : "")
/**
 * Whether folded text holds a words pattern as literal text. Each edge of the pattern that ends in a word character must meet a
 * character that does not continue the word, or the end of the text. A * at the start or end of the pattern lifts that edge's
 * boundary, and a * anywhere else is literal
 */
export function wordMatches(folded: string, pattern: string) {
    const value = foldWords(pattern)
    const open = { left: value.startsWith("*"), right: value.length > 1 && value.endsWith("*") }
    const core = value.slice(open.left ? 1 : 0, open.right ? -1 : undefined)
    if (core === "") return false
    const first = after(core, 0),
        last = before(core, core.length)
    for (let at = folded.indexOf(core); at !== -1; at = folded.indexOf(core, at + 1)) {
        const end = at + core.length
        if (
            (open.left || !joins(first) || !joins(before(folded, at))) &&
            (open.right || !joins(last) || !joins(after(folded, end)))
        )
            return true
    }
    return false
}
export function domains(content: string): string[] {
    const result: string[] = []
    for (const match of content.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>]+/gi)) {
        try {
            const raw = match[0].replace(/[),.!?;]+$/, "")
            const parsed = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw)
            result.push(parsed.hostname.toLowerCase().replace(/\.$/, ""))
        } catch {
            /* Malformed local text is not a URL */
        }
    }
    return result
}
export function domainMatches(hosts: string[], patterns: string[]) {
    return hosts.some((host) => patterns.some((p) => host === p || host.endsWith(`.${p}`)))
}
