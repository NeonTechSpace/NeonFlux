import { BackupManageResult, BackupManifest, BackupPreviewFailedResult, BackupPreviewPage, BackupPreviewReadyResult, BackupQueryResult, BackupSnapshot, BackupWorkResult, backupWithinLimits,
    type BackupBinding, type BackupItem, type BackupItemBinding, type BackupManageRequest, type BackupPreviewFailedRequest, type BackupPreviewRequest, type BackupQueryRequest, type BackupSnapshotRequest,
    type BackupWorkRequest } from "@neonflux/contracts/backup"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import type { BackendConfig } from "./config.ts"
import { createBackendRequest } from "./backend-http.ts"
import { backupPlaintextLimit } from "./backup-crypto.ts"

const unique = <A>(v: readonly A[], key: (v: A) => string) => new Set(v.map(key)).size === v.length
export const backupSafeAllowMask = Permissions.ViewChannel | Permissions.SendMessages | Permissions.ReadMessageHistory | Permissions.AddReactions | Permissions.EmbedLinks | Permissions.AttachFiles | Permissions.Connect | Permissions.Speak | Permissions.UseVad | Permissions.Stream | Permissions.ViewChannelMembers
    | Permissions.CreatePublicThreads | Permissions.SendMessagesInThreads
export const backupKnownDenyMask = Object.values(Permissions).reduce((a, b) => a | b, 0n)
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
export function validateBackupManifest(value: unknown): BackupManifest {
    try {
        if (Buffer.byteLength(JSON.stringify(value), "utf8") > backupPlaintextLimit) throw new Error()
        const manifest = Schema.decodeUnknownSync(BackupManifest, { onExcessProperty: "error" })(withoutLegacyFields(value))
        // Exports stay within the restore plan limits, so every valid archive can be restored
        const items = manifest.config.length + manifest.xp.length + manifest.structure.length
        if (!backupWithinLimits(manifest) || items > backupRestoreItemLimit || Buffer.byteLength(canonicalBackupJson(manifest), "utf8") > backupRestoreByteLimit) throw new Error()
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
export const backupBinding = (v: BackupBinding): BackupBinding => ({ planId: v.planId, revision: v.revision, planHash: v.planHash, archiveDigest: v.archiveDigest })
export const backupItemBinding = (v: BackupItemBinding): BackupItemBinding => ({ ...backupBinding(v), itemNo: v.itemNo, generation: v.generation })
const sameBinding = (a: BackupBinding, b: BackupBinding) => a.planId === b.planId && a.revision === b.revision && a.planHash === b.planHash && a.archiveDigest === b.archiveDigest
export interface BackupStore {
    snapshot(input: BackupSnapshotRequest): Effect.Effect<BackupSnapshot, BackupStoreError>
    query(input: BackupQueryRequest): Effect.Effect<BackupQueryResult, BackupStoreError>
    manage(input: BackupManageRequest): Effect.Effect<BackupManageResult, BackupStoreError>
    work(input: BackupWorkRequest): Effect.Effect<BackupWorkResult, BackupStoreError>
    preview(input: BackupPreviewRequest): Effect.Effect<BackupPreviewPage, BackupStoreError>
    previewReady(serverId: string): Effect.Effect<BackupPreviewReadyResult, BackupStoreError>
    previewFailed(serverId: string, failure: BackupPreviewFailedRequest["failure"]): Effect.Effect<BackupPreviewFailedResult, BackupStoreError>
}
export function createBackupStore(config: BackendConfig): BackupStore {
    const request = createBackendRequest(config)
    const call = <A>(op: string, input: unknown, schema: Schema.Codec<A>, matches: (v: A, now: number) => boolean) => request(`/backup/${op}`, input).pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })), Effect.flatMap(v => Clock.currentTimeMillis.pipe(Effect.flatMap(now => matches(v, now) ? Effect.succeed(v) : Effect.fail(new BackupStoreError({ operation: op, status: null }))))), Effect.mapError(e => new BackupStoreError({ operation: op, status: "status" in e && typeof e.status === "number" ? e.status : null })))
    const matchesItem = (v: BackupItem, b: BackupItemBinding) => sameBinding(v, b) && v.itemNo === b.itemNo && v.generation === b.generation
    return {
        snapshot: input => call("snapshot", input, BackupSnapshot, (v, now) => v.capturedAt <= now + 5000 && v.capturedAt >= input.context.observedAt - 5000 && (input.selected.includes("config") || !v.config.length) && (input.selected.includes("xp") || !v.xp.length)),
        query: input => call("query", input, BackupQueryResult, v => {
            const op = input.operation
            if (v.type !== op.type) return false
            if (v.type === "capabilities") return unique(v.capabilities.configFamilies, x => x) && BigInt(v.capabilities.safeAllowMask) === backupSafeAllowMask && BigInt(v.capabilities.knownDenyMask) === backupKnownDenyMask
            if (v.type === "plan" && op.type === "plan") return sameBinding(v.plan, op.binding) && v.plan.serverId === input.serverId && v.plan.ownerId === input.context.ownerId
            if (v.type === "item" && op.type === "item") return matchesItem(v.item, op.binding) && (!v.object || "family" in v.object ? !v.object || v.object.family === v.item.family && v.object.sourceId === v.item.sourceId : v.object.sourceId === v.item.sourceId)
            if (v.type === "items" && op.type === "items") return v.items.every(i => sameBinding(i, op.binding)) && (!v.nextCursor || v.nextCursor !== op.cursor)
            if (v.type === "plans" && op.type === "plans") return v.plans.every(p => p.serverId === input.serverId && p.ownerId === input.context.ownerId) && (!v.nextCursor || v.nextCursor !== op.cursor)
            if (v.type === "origins" && op.type === "origins") return v.origins.every(o => o.serverId === input.serverId && o.provider === op.provider) && (!v.nextCursor || v.nextCursor !== op.cursor)
            return v.type === "preview"
        }),
        preview: input => call("preview", input, BackupPreviewPage, v => v.backupId === input.manifest.backupId && v.archiveDigest === input.archiveDigest),
        previewReady: serverId => call("preview-ready", { serverId }, BackupPreviewReadyResult, () => true),
        previewFailed: (serverId, failure) => call("preview-failed", { serverId, failure }, BackupPreviewFailedResult, () => true),
        manage: input => call("manage", input, BackupManageResult, v => {
            const op = input.operation, p = v.plan
            if (p.serverId !== input.serverId || p.ownerId !== input.context.ownerId) return false
            if (op.type === "plan") return v.type === "plan" && p.archiveDigest === op.archiveDigest && p.backupId === op.manifest.backupId && p.provider === op.manifest.provider && v.items.every(i => sameBinding(i, p))
            return sameBinding(p, op.binding) && (op.type === "confirm" ? v.type === "confirmed" && p.confirmedAt !== undefined : v.type === "forgotten" && p.forgotten)
        }),
        work: input => call("work", input, BackupWorkResult, (v, now) => {
            const op = input.operation
            if (!matchesItem(v.item, op.binding)) return false
            if (v.type === "item") return true
            const g = v.grant
            return (op.type === "reserve" || op.type === "claim") && matchesItem({ ...v.item, ...g }, op.binding) && g.serverId === input.serverId && g.ownerId === op.context.ownerId && g.botId === op.context.botId && g.sourceId === v.item.sourceId && g.channel.sourceId === v.item.sourceId && g.dispatchExpiresAt === v.item.dispatchExpiresAt && g.dispatchExpiresAt <= now + 120000 && g.dispatchExpiresAt > op.context.observedAt && (op.type === "claim" || !v.claimed)
        }),
    }
}
