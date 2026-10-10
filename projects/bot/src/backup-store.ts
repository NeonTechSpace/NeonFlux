import type * as C from "@neonflux/backend/contracts"
import { snowflakes, Permissions } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import type { BackendConfig } from "./config.ts"
import { createBackendRequest } from "./backend-http.ts"
import { publishingContentSchema } from "./publishing-content.ts"
import { backupPlaintextLimit } from "./backup-crypto.ts"
import { rolesReservationsSchema } from "./roles-store.ts"
import { metadataLogCategories, metadataLogEventSelectors } from "./metadata-log-command.ts"
import { automodRuleTypes } from "./moderation-store.ts"

const n = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= min && v <= max))
const text = (max = 256, min = 1) => Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max))
const id = text(20).check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const name = text(32).check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,31}$/))
const hash = text(64).check(Schema.isPattern(/^[a-f0-9]{64}$/))
const provider = text(2048).check(Schema.makeFilter(v => { try { const url = new URL(v); return ["https:", "http:"].includes(url.protocol) && url.origin === v && !url.username && !url.password } catch { return false } }))
const optional = Schema.optionalKey
const list = <A>(s: Schema.Codec<A>, max = 20) => Schema.mutable(Schema.Array(s)).check(Schema.isMaxLength(max))
const unique = <A>(v: readonly A[], key: (v: A) => string) => new Set(v.map(key)).size === v.length
const ids = (max = 20) => list(id, max).check(Schema.makeFilter(v => unique(v, x => x)))
const enabled = Schema.Struct({ enabled: Schema.Boolean })
const mapping = Schema.Struct({ emoji: text(), roleId: id, prerequisiteRoleIds: ids(), exclusionRoleIds: ids() })
const mappings = list(mapping).check(Schema.makeFilter(v => unique(v, x => x.emoji) && unique(v, x => x.roleId)))
const content = publishingContentSchema
const template = Schema.Struct({ name, revision: n(1) })
const greetingRoute = Schema.Struct({ enabled: Schema.Boolean, timing: Schema.Literals(["join", "verified"]), channelId: optional(id), templateName: optional(name), templateRevision: optional(n(1)), content: optional(content) })
const logRoute = Schema.Struct({ category: Schema.Literals(metadataLogCategories), enabled: Schema.Boolean, channelId: optional(id), ownerId: optional(id) })
const logEventRoute = Schema.Struct({ eventType: Schema.Literals(metadataLogEventSelectors), enabled: Schema.Boolean, channelId: optional(id), ownerId: optional(id) })
    .check(Schema.makeFilter(v => (v.channelId === undefined) === (v.ownerId === undefined) && (!v.enabled || !!v.channelId && !!v.ownerId)))
const values = {
    moderation: Schema.Struct({ staffRoleIds: Schema.Struct({ moderation: ids(), cases: ids(), automod: ids(), security: ids(), appeals: ids() }), logChannelId: Schema.NullOr(id), manualModerationEnabled: Schema.Boolean,
        automodEnabled: Schema.Boolean, automodMode: Schema.Literals(["dry-run", "enforce"]), automodBotMessagesEnabled: optional(Schema.Boolean), securityEnabled: Schema.Boolean, securityMode: Schema.Literals(["dry-run", "enforce"]), joinEnabled: Schema.Boolean, joinThreshold: n(2, 100), joinWindowSeconds: n(1, 300), joinDefcon2: Schema.Boolean, honeypotEnabled: Schema.Boolean, honeypotChannelIds: ids(), watchlistEnabled: Schema.Boolean, appealsEnabled: Schema.Boolean }),
    responses: Schema.Struct({ customEnabled: Schema.Boolean, autoEnabled: Schema.Boolean }),
    response: Schema.Struct({ kind: Schema.Literals(["custom", "auto"]), name, reply: Schema.Union([Schema.Struct({ type: Schema.Literal("text"), text: text(2000) }), Schema.Struct({ type: Schema.Literal("embed"), embed: Schema.Struct({ title: text(256, 0), description: text(4000), color: optional(n(0, 16777215)) }) })]), trigger: optional(Schema.Struct({ mode: Schema.Literals(["exact", "contains"]), text: text(200) })), channelIds: ids(), roleIds: ids(), cooldownSeconds: n(0, 3600), priority: n(-100, 100), enabled: Schema.Boolean }).check(Schema.makeFilter(v => v.name !== "backup" && (v.kind === "auto" ? !!v.trigger : v.trigger === undefined))),
    automod: Schema.Struct({ name, type: Schema.Literals(automodRuleTypes), enabled: Schema.Boolean, priority: n(-100, 100), action: Schema.Literals(["log", "delete", "warn", "timeout"]), threshold: n(1, 100), windowSeconds: n(1, 300), durationSeconds: n(1, 31536000), patterns: list(text(200)), domainMode: Schema.Literals(["block", "allow"]), channelIds: ids(), exemptChannelIds: ids(), exemptRoleIds: ids() }),
    publishing: Schema.Struct({ enabled: Schema.Boolean, retentionDays: n(30, 3650) }),
    draft: Schema.Struct({ kind: Schema.Literals(["draft", "template"]), name, content }),
    roles: Schema.Struct({ panelsEnabled: Schema.Boolean, verificationEnabled: Schema.Boolean, advancedVerificationEnabled: optional(Schema.Boolean), autoroleEnabled: Schema.Boolean, humansOnly: Schema.Boolean, autoroleIds: ids(), reservations: optional(rolesReservationsSchema) }),
    panel: Schema.Struct({ name, kind: Schema.Literals(["reaction", "verification"]), enabled: Schema.Boolean, exclusive: Schema.Boolean, mappings }).check(Schema.makeFilter(v => v.kind !== "verification" || v.mappings.length <= 1)),
    greetings: Schema.Struct({ claimsPerMinute: n(1, 60), retentionDays: n(30, 3650), routes: Schema.Struct({ welcome: greetingRoute, dm: greetingRoute, goodbye: greetingRoute }) }).check(Schema.makeFilter(v => v.routes.dm.channelId === undefined && Object.values(v.routes).every(r => !r.enabled || !!r.content && !!r.templateName && !!r.templateRevision) && [v.routes.welcome, v.routes.goodbye].every(r => !r.enabled || !!r.channelId))),
    tickets: Schema.Struct({ enabled: Schema.Boolean, retentionDays: n(1, 365) }),
    ticketCategory: Schema.Struct({ name, enabled: Schema.Boolean, visibility: Schema.Literals(["private", "public"]), description: text(1000, 0), parentId: Schema.NullOr(id), supportRoleIds: ids(), questions: list(text(200), 5), cannedReplies: list(Schema.Struct({ name, templateName: name, templateRevision: n(1), content })) }).check(Schema.makeFilter(v => unique(v.cannedReplies, x => x.name))),
    leveling: Schema.Struct({ enabled: Schema.Boolean, xpPerMessage: n(1, 100), cooldownSeconds: n(15, 3600), excludedChannelIds: ids(50), excludedRoleIds: ids(50), mappings: list(Schema.Struct({ level: n(1, 1000), roleId: id })) }).check(Schema.makeFilter(v => unique(v.mappings, x => String(x.level)) && unique(v.mappings, x => x.roleId))),
    milestones: enabled,
    milestoneRoute: Schema.Struct({ kind: Schema.Literals(["birthday", "anniversary"]), channelId: id, zone: text(128).check(Schema.makeFilter(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true } catch { return false } })), time: text(5).check(Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)), fold: Schema.Literals(["earlier", "later", "reject"]), template, content, enabled: Schema.Boolean }),
    suggestions: Schema.Struct({ enabled: Schema.Boolean, channelId: optional(id), ownerId: optional(id) }).check(Schema.makeFilter(v => !v.enabled || !!v.channelId)),
    cleanup: enabled,
    cleanupPolicy: Schema.Struct({ channelId: id, enabled: Schema.Boolean, ageMs: n(3600000, 31536000000), ownerId: id, excludedAuthorIds: ids(50), excludedMessageIds: ids(100) }),
    // A backup from before the security category has six routes
    metadata: Schema.Struct({ enabled: Schema.Boolean, routes: list(logRoute, 7), eventRoutes: optional(list(logEventRoute, metadataLogEventSelectors.length).check(Schema.makeFilter(v => unique(v, x => x.eventType)))), messageChannelIds: ids(50), excludedChannelIds: ids(50) }).check(Schema.makeFilter(v => v.routes.length >= 6 && metadataLogCategories.every(c => c === "security" || v.routes.some(r => r.category === c)) && unique(v.routes, x => x.category) && v.routes.every(r => (r.channelId === undefined) === (r.ownerId === undefined) && (!r.enabled || !!r.channelId && !!r.ownerId)))),
    events: enabled, schedules: enabled,
} satisfies { [K in C.BackupConfigFamily]: Schema.Codec<C.BackupConfigValues[K]> }
export const backupConfigFamilies = Object.keys(values) as C.BackupConfigFamily[]
export const backupExclusions = ["credentials", "native-roles", "server-settings", "messages", "private-history", "participation", "membership", "audit-history", "receipts", "leases", "cooldowns", "claims", "live-ownership", "effective-defcon", "event-definitions", "schedule-definitions"]
export function backupConfigIdentity(object: C.BackupConfigObject) {
    switch (object.family) {
        case "response": case "draft": return `${object.value.kind}_${object.value.name}`
        case "automod": case "panel": case "ticketCategory": return object.value.name
        case "milestoneRoute": return object.value.kind
        case "cleanupPolicy": return object.value.channelId
        default: return object.family
    }
}
export const backupConfigObjectSchema: Schema.Codec<C.BackupConfigObject> = (Schema.Union(Object.entries(values).map(([family, value]) => Schema.Struct({ family: Schema.Literal(family), sourceId: text(128), value }))) as Schema.Codec<C.BackupConfigObject>).check(Schema.makeFilter(v => v.sourceId === backupConfigIdentity(v)))
export const backupSafeAllowMask = Permissions.ViewChannel | Permissions.SendMessages | Permissions.ReadMessageHistory | Permissions.AddReactions | Permissions.EmbedLinks | Permissions.AttachFiles | Permissions.Connect | Permissions.Speak | Permissions.UseVad | Permissions.Stream | Permissions.ViewChannelMembers
export const backupKnownDenyMask = Object.values(Permissions).reduce((a, b) => a | b, 0n)
const mask = text(19).check(Schema.makeFilter(v => /^(?:0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n))
const overwrite = Schema.Struct({ id, type: Schema.Literals(["role", "member"]), allow: mask, deny: mask }).check(Schema.makeFilter(v => !(BigInt(v.allow) & ~backupSafeAllowMask) && !(BigInt(v.deny) & ~backupKnownDenyMask) && !(BigInt(v.allow) & BigInt(v.deny))))
export const backupStructureObjectSchema = Schema.Struct({ sourceId: id, type: Schema.Literals(["category", "text", "voice"]), name: text(100).check(Schema.makeFilter(v => v.trim() === v && !/[\u0000-\u001f\u202e]/.test(v))), parentId: Schema.NullOr(id), overwrites: list(overwrite, 100).check(Schema.makeFilter(v => unique(v, x => x.id))), topic: optional(Schema.NullOr(text(1024, 0))), nsfw: optional(Schema.Boolean), slowmodeSeconds: optional(n(0, 21600)), bitrate: optional(n(8000, 384000)), userLimit: optional(n(0, 99)), capturedAt: n() }).check(Schema.makeFilter(v => v.parentId !== v.sourceId && (v.type === "category" ? v.parentId === null && v.topic === undefined && v.nsfw === undefined && v.bitrate === undefined && v.userLimit === undefined && v.slowmodeSeconds === undefined : v.type === "text" ? v.bitrate === undefined && v.userLimit === undefined : v.topic === undefined && v.nsfw === undefined && v.slowmodeSeconds === undefined)))
const xpObject = Schema.Struct({ sourceId: id, userId: id, xp: n(0, 100000000) }).check(Schema.makeFilter(v => v.sourceId === v.userId))
const configObjects = list(backupConfigObjectSchema, 500).check(Schema.makeFilter(v => unique(v, x => `${x.family}:${x.sourceId}`)))
const xpObjects = list(xpObject, 1000).check(Schema.makeFilter(v => unique(v, x => x.userId)))
const structures = list(backupStructureObjectSchema, 100).check(Schema.makeFilter(v => unique(v, x => x.sourceId) && v.reduce((n, c) => n + c.overwrites.length, 0) <= 500))
const category = Schema.Literals(["config", "xp", "structure"])
const selected = list(category, 3).check(Schema.isMinLength(1), Schema.makeFilter(v => unique(v, x => x)))
export const backupManifestSchema: Schema.Codec<C.BackupManifest> = Schema.Struct({ version: Schema.Literal(1), backupId: text(128).check(Schema.isPattern(/^[a-zA-Z0-9_-]+$/)), provider, serverId: id, selected, capturedAt: n(), observations: Schema.Struct({ databaseAt: Schema.NullOr(n()), structureStartedAt: Schema.NullOr(n()), structureFinishedAt: Schema.NullOr(n()) }), counts: Schema.Struct({ config: n(0, 500), xp: n(0, 1000), structure: n(0, 100), overwrites: n(0, 500) }), exclusions: list(text(256), 100), config: configObjects, xp: xpObjects, structure: structures }).check(Schema.makeFilter(v => {
    const o = v.observations
    return v.counts.config === v.config.length && v.counts.xp === v.xp.length && v.counts.structure === v.structure.length && v.counts.overwrites === v.structure.reduce((n, c) => n + c.overwrites.length, 0)
        && v.selected.every(c => c !== "config" || o.databaseAt !== null) && v.selected.every(c => c !== "xp" || o.databaseAt !== null)
        && (!v.config.length || v.selected.includes("config")) && (!v.xp.length || v.selected.includes("xp")) && (!v.structure.length || v.selected.includes("structure"))
        && (v.selected.includes("structure") ? o.structureStartedAt !== null && o.structureFinishedAt !== null && o.structureStartedAt <= o.structureFinishedAt && v.structure.every(c => c.capturedAt >= o.structureStartedAt! && c.capturedAt <= o.structureFinishedAt!) : o.structureStartedAt === null && o.structureFinishedAt === null)
        && v.structure.every(c => !c.parentId || !v.structure.some(p => p.sourceId === c.parentId && p.type !== "category"))
        && v.exclusions.join("\n") === backupExclusions.join("\n") && (o.databaseAt === null || o.databaseAt <= v.capturedAt) && (o.structureFinishedAt === null || o.structureFinishedAt <= v.capturedAt)
}))
export class BackupStoreError extends Data.TaggedError("BackupStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export const backupRestoreItemLimit = 500, backupRestoreByteLimit = 524288
// Archives written before role retention became fixed still carry its former setting, which is discarded
function withoutLegacyFields(value: unknown): unknown {
    if (!value || typeof value !== "object" || !Array.isArray((value as { config?: unknown }).config)) return value
    return { ...value, config: (value as { config: unknown[] }).config.map(item => {
        if (!item || typeof item !== "object" || (item as { family?: unknown }).family !== "roles") return item
        const roles = item as { value?: unknown }
        if (!roles.value || typeof roles.value !== "object") return item
        const { retentionDays: _, ...rest } = roles.value as Record<string, unknown>
        return { ...roles, value: rest }
    }) }
}
export function validateBackupManifest(value: unknown): C.BackupManifest {
    try {
        if (Buffer.byteLength(JSON.stringify(value), "utf8") > backupPlaintextLimit) throw new Error()
        const manifest = Schema.decodeUnknownSync(backupManifestSchema, { onExcessProperty: "error" })(withoutLegacyFields(value))
        // Exports stay within the restore plan limits, so every valid archive can be restored
        const items = manifest.config.length + manifest.xp.length + manifest.structure.length
        if (items > backupRestoreItemLimit || Buffer.byteLength(canonicalBackupJson(manifest), "utf8") > backupRestoreByteLimit) throw new Error()
        return manifest
    } catch { throw new BackupStoreError({ operation: "manifest", status: null }) }
}
/** Stable comparison and integrity projection, independent of source property order */
export function canonicalBackupJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalBackupJson).join(",")}]`
    if (value && typeof value === "object") return `{${Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonicalBackupJson((value as Record<string, unknown>)[k])}`).join(",")}}`
    return JSON.stringify(value)
}
export const backupDigest = (value: unknown) => createHash("sha256").update(canonicalBackupJson(value)).digest("hex")
export const backupBinding = (v: C.BackupBinding): C.BackupBinding => ({ planId: v.planId, revision: v.revision, planHash: v.planHash, archiveDigest: v.archiveDigest })
export const backupItemBinding = (v: C.BackupItemBinding): C.BackupItemBinding => ({ ...backupBinding(v), itemNo: v.itemNo, generation: v.generation })
const sameBinding = (a: C.BackupBinding, b: C.BackupBinding) => a.planId === b.planId && a.revision === b.revision && a.planHash === b.planHash && a.archiveDigest === b.archiveDigest
const bindingFields = { planId: text(256), revision: Schema.Literal(1), planHash: hash, archiveDigest: hash }
const itemFields = { ...bindingFields, itemNo: n(1, 500), generation: Schema.Literal(1) }
const disposition = Schema.Literals(["create", "skip", "conflict", "blocked"])
export const backupPlanSchema: Schema.Codec<C.BackupPlan> = Schema.Struct({ ...bindingFields, backupId: text(128), manifestDigest: hash, provider, serverId: id, ownerId: id, createdAt: n(), expiresAt: n(), confirmedAt: optional(n()), itemCount: n(0, 500), counts: Schema.Struct({ create: n(0, 500), skip: n(0, 500), conflict: n(0, 500), blocked: n(0, 500) }), forgotten: Schema.Boolean }).check(Schema.makeFilter(v => v.expiresAt === v.createdAt + 900000 && Object.values(v.counts).reduce((a, b) => a + b, 0) === v.itemCount && (v.confirmedAt === undefined || v.confirmedAt >= v.createdAt && v.confirmedAt < v.expiresAt)))
export const backupItemSchema: Schema.Codec<C.BackupItem> = Schema.Struct({ ...itemFields, category, family: Schema.Literals([...backupConfigFamilies, "xp", "structure"]), sourceId: text(128), disposition, reason: Schema.NullOr(text(256)), state: Schema.Literals(["planned", "reserved", "claimed", "created", "skipped", "conflict", "blocked", "failed", "uncertain"]), expectedHash: hash, desiredHash: hash, dependencyItemNo: Schema.NullOr(n(1, 500)), mappedId: Schema.NullOr(text(256)), disabledOnCreate: Schema.Boolean, dispatchExpiresAt: optional(n()), claimedAt: optional(n()), finishedAt: optional(n()), noDispatch: optional(Schema.Literal(true)), historicalOutcome: optional(Schema.Literals(["created", "failed", "uncertain"])), resolution: optional(Schema.Literals(["match", "absent", "conflict"])) }).check(Schema.makeFilter(v => v.category === "config" ? backupConfigFamilies.includes(v.family as C.BackupConfigFamily) : v.family === v.category)).check(Schema.makeFilter(v => v.category !== "structure" || v.mappedId === null || snowflakes.isValid(v.mappedId) && v.mappedId !== "0"))
const itemList = list(backupItemSchema).check(Schema.makeFilter(v => unique(v, x => String(x.itemNo))))
const cursor = optional(text(8192))
const capabilities: Schema.Codec<C.BackupCapabilities> = Schema.Struct({ version: Schema.Literal(1), configFamilies: list(Schema.Literals(backupConfigFamilies), 30), exclusions: list(text(256), 100), limits: Schema.Struct({ xp: Schema.Literal(1000), structure: Schema.Literal(100), overwrites: Schema.Literal(500), planItems: Schema.Literal(500), plans: Schema.Literal(10), page: Schema.Literal(20), planMs: Schema.Literal(900000), snapshotBytes: Schema.Literal(1048576), planBytes: Schema.Literal(524288), originMappings: Schema.Literal(5000) }), safeAllowMask: mask, knownDenyMask: mask })
const origin: Schema.Codec<C.BackupOrigin> = Schema.Struct({ provider, serverId: id, category, family: Schema.Literals([...backupConfigFamilies, "xp", "structure"]), sourceId: text(128), state: Schema.Literals(["reserved", "claimed", "created", "uncertain", "failed"]), planId: text(256), itemNo: n(1, 500), generation: Schema.Literal(1), mappedId: Schema.NullOr(text(256)), desiredHash: hash, resolved: optional(Schema.Literals(["match", "absent", "conflict"])) }).check(Schema.makeFilter(v => v.category !== "structure" || v.mappedId === null || snowflakes.isValid(v.mappedId) && v.mappedId !== "0"))
const querySchema: Schema.Codec<C.BackupQueryResult> = Schema.Union([Schema.Struct({ type: Schema.Literal("capabilities"), capabilities }), Schema.Struct({ type: Schema.Literal("plans"), plans: list(backupPlanSchema), nextCursor: cursor }), Schema.Struct({ type: Schema.Literal("plan"), plan: backupPlanSchema }), Schema.Struct({ type: Schema.Literal("items"), items: itemList, nextCursor: cursor }), Schema.Struct({ type: Schema.Literal("item"), item: backupItemSchema, object: Schema.NullOr(Schema.Union([backupConfigObjectSchema, xpObject, backupStructureObjectSchema])) }), Schema.Struct({ type: Schema.Literal("origins"), origins: list(origin), nextCursor: cursor })])
const manageSchema: Schema.Codec<C.BackupManageResult> = Schema.Union([Schema.Struct({ type: Schema.Literal("plan"), duplicate: Schema.Boolean, plan: backupPlanSchema, items: itemList, nextCursor: cursor }), Schema.Struct({ type: Schema.Literal("confirmed"), duplicate: Schema.Boolean, plan: backupPlanSchema }), Schema.Struct({ type: Schema.Literal("forgotten"), plan: backupPlanSchema })])
const grantSchema: Schema.Codec<C.BackupGrant> = Schema.Struct({ ...itemFields, provider, serverId: id, ownerId: id, botId: id, sourceId: id, channel: backupStructureObjectSchema, dispatchExpiresAt: n(), nativeDeadlineMs: Schema.Literal(5000) })
const workSchema: Schema.Codec<C.BackupWorkResult> = Schema.Union([Schema.Struct({ type: Schema.Literal("item"), item: backupItemSchema }), Schema.Struct({ type: Schema.Literal("grant"), item: backupItemSchema, grant: grantSchema, claimed: Schema.Boolean })])
const snapshotSchema: Schema.Codec<C.BackupSnapshot> = Schema.Struct({ capturedAt: n(), config: configObjects, xp: xpObjects, counts: Schema.Struct({ config: n(0, 500), xp: n(0, 1000) }) }).check(Schema.makeFilter(v => v.counts.config === v.config.length && v.counts.xp === v.xp.length))
export interface BackupStore {
    snapshot(input: C.BackupSnapshotRequest): Effect.Effect<C.BackupSnapshot, BackupStoreError>
    query(input: C.BackupQueryRequest): Effect.Effect<C.BackupQueryResult, BackupStoreError>
    manage(input: C.BackupManageRequest): Effect.Effect<C.BackupManageResult, BackupStoreError>
    work(input: C.BackupWorkRequest): Effect.Effect<C.BackupWorkResult, BackupStoreError>
}
export function createBackupStore(config: BackendConfig): BackupStore {
    const request = createBackendRequest(config)
    const call = <A>(op: string, input: unknown, schema: Schema.Codec<A>, matches: (v: A, now: number) => boolean) => request(`/backup/${op}`, input).pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })), Effect.flatMap(v => Clock.currentTimeMillis.pipe(Effect.flatMap(now => matches(v, now) ? Effect.succeed(v) : Effect.fail(new BackupStoreError({ operation: op, status: null }))))), Effect.mapError(e => new BackupStoreError({ operation: op, status: "status" in e && typeof e.status === "number" ? e.status : null })))
    const matchesItem = (v: C.BackupItem, b: C.BackupItemBinding) => sameBinding(v, b) && v.itemNo === b.itemNo && v.generation === b.generation
    return {
        snapshot: input => call("snapshot", input, snapshotSchema, (v, now) => v.capturedAt <= now + 5000 && v.capturedAt >= input.context.observedAt - 5000 && (input.selected.includes("config") || !v.config.length) && (input.selected.includes("xp") || !v.xp.length)),
        query: input => call("query", input, querySchema, v => {
            const op = input.operation
            if (v.type !== op.type) return false
            if (v.type === "capabilities") return unique(v.capabilities.configFamilies, x => x) && BigInt(v.capabilities.safeAllowMask) === backupSafeAllowMask && BigInt(v.capabilities.knownDenyMask) === backupKnownDenyMask
            if (v.type === "plan" && op.type === "plan") return sameBinding(v.plan, op.binding) && v.plan.serverId === input.serverId && v.plan.ownerId === input.context.ownerId
            if (v.type === "item" && op.type === "item") return matchesItem(v.item, op.binding) && (!v.object || "family" in v.object ? !v.object || v.object.family === v.item.family && v.object.sourceId === v.item.sourceId : v.object.sourceId === v.item.sourceId)
            if (v.type === "items" && op.type === "items") return v.items.every(i => sameBinding(i, op.binding)) && (!v.nextCursor || v.nextCursor !== op.cursor)
            if (v.type === "plans" && op.type === "plans") return v.plans.every(p => p.serverId === input.serverId && p.ownerId === input.context.ownerId) && (!v.nextCursor || v.nextCursor !== op.cursor)
            if (v.type === "origins" && op.type === "origins") return v.origins.every(o => o.serverId === input.serverId && o.provider === op.provider) && (!v.nextCursor || v.nextCursor !== op.cursor)
            return false
        }),
        manage: input => call("manage", input, manageSchema, v => {
            const op = input.operation, p = v.plan
            if (p.serverId !== input.serverId || p.ownerId !== input.context.ownerId) return false
            if (op.type === "plan") return v.type === "plan" && p.archiveDigest === op.archiveDigest && p.backupId === op.manifest.backupId && p.provider === op.manifest.provider && v.items.every(i => sameBinding(i, p))
            return sameBinding(p, op.binding) && (op.type === "confirm" ? v.type === "confirmed" && p.confirmedAt !== undefined : v.type === "forgotten" && p.forgotten)
        }),
        work: input => call("work", input, workSchema, (v, now) => {
            const op = input.operation
            if (!matchesItem(v.item, op.binding)) return false
            if (v.type === "item") return true
            const g = v.grant
            return (op.type === "reserve" || op.type === "claim") && matchesItem({ ...v.item, ...g }, op.binding) && g.serverId === input.serverId && g.ownerId === op.context.ownerId && g.botId === op.context.botId && g.sourceId === v.item.sourceId && g.channel.sourceId === v.item.sourceId && g.dispatchExpiresAt === v.item.dispatchExpiresAt && g.dispatchExpiresAt <= now + 120000 && g.dispatchExpiresAt > op.context.observedAt && (op.type === "claim" || !v.claimed)
        }),
    }
}
