import {
    BACKUP_RESTORE_LIMITS,
    BackupManageResult,
    BackupManifest,
    canonicalBackupJson,
    BackupPreviewFailedResult,
    BackupPreviewReadyResult,
    BackupPreviewResult,
    BackupQueryResult,
    BackupSnapshot,
    BackupWorkResult,
    backupWithinLimits,
    type BackupBinding,
    type BackupItem,
    type BackupItemBinding,
    type BackupManageRequest,
    type BackupPreviewFailedRequest,
    type BackupPreviewRequest,
    type BackupQueryRequest,
    type BackupRunStepRequest,
    type BackupSnapshotRequest,
    type BackupWorkRequest,
} from "@neonflux/contracts/backup"
import { Clock, Data, Effect, Schema } from "effect"
import type { BackendConfig } from "./config.ts"
import { createBackendRequest } from "./backend-http.ts"

const unique = <A>(v: readonly A[], key: (v: A) => string) => new Set(v.map(key)).size === v.length
export class BackupStoreError extends Data.TaggedError("BackupStoreError")<{
    readonly operation: string
    readonly status: number | null
}> {}
export function validateBackupManifest(value: unknown): BackupManifest {
    try {
        const manifest = Schema.decodeUnknownSync(BackupManifest, { onExcessProperty: "error" })(value)
        // Exports stay within the restore plan limits, so every valid archive can be restored
        const items = manifest.config.length + manifest.xp.length + manifest.structure.length
        if (
            !backupWithinLimits(manifest) ||
            items > BACKUP_RESTORE_LIMITS.planItems ||
            Buffer.byteLength(canonicalBackupJson(manifest), "utf8") > BACKUP_RESTORE_LIMITS.planBytes
        )
            throw new Error()
        return manifest
    } catch {
        throw new BackupStoreError({ operation: "manifest", status: null })
    }
}
export const backupBinding = (v: BackupBinding): BackupBinding => ({
    planId: v.planId,
    revision: v.revision,
    planHash: v.planHash,
    archiveDigest: v.archiveDigest,
})
export const backupItemBinding = (v: BackupItemBinding): BackupItemBinding => ({
    ...backupBinding(v),
    itemNo: v.itemNo,
    generation: v.generation,
})
const sameBinding = (a: BackupBinding, b: BackupBinding) =>
    a.planId === b.planId &&
    a.revision === b.revision &&
    a.planHash === b.planHash &&
    a.archiveDigest === b.archiveDigest
export interface BackupStore {
    snapshot(input: BackupSnapshotRequest): Effect.Effect<BackupSnapshot, BackupStoreError>
    query(input: BackupQueryRequest): Effect.Effect<BackupQueryResult, BackupStoreError>
    manage(input: BackupManageRequest): Effect.Effect<BackupManageResult, BackupStoreError>
    work(input: BackupWorkRequest): Effect.Effect<BackupWorkResult, BackupStoreError>
    preview(input: BackupPreviewRequest): Effect.Effect<BackupPreviewResult, BackupStoreError>
    previewReady(serverId: string): Effect.Effect<BackupPreviewReadyResult, BackupStoreError>
    previewFailed(
        serverId: string,
        requestedAt: number,
        failure: BackupPreviewFailedRequest["failure"],
    ): Effect.Effect<BackupPreviewFailedResult, BackupStoreError>
    runStep(input: BackupRunStepRequest): Effect.Effect<BackupPreviewFailedResult, BackupStoreError>
}
export function createBackupStore(config: BackendConfig): BackupStore {
    const request = createBackendRequest(config)
    const call = <A>(op: string, input: unknown, schema: Schema.Codec<A>, matches: (v: A, now: number) => boolean) =>
        request(`/backup/${op}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.flatMap((v) =>
                Clock.currentTimeMillis.pipe(
                    Effect.flatMap((now) =>
                        matches(v, now)
                            ? Effect.succeed(v)
                            : Effect.fail(new BackupStoreError({ operation: op, status: null })),
                    ),
                ),
            ),
            Effect.mapError(
                (e) =>
                    new BackupStoreError({
                        operation: op,
                        status: "status" in e && typeof e.status === "number" ? e.status : null,
                    }),
            ),
        )
    const matchesItem = (v: BackupItem, b: BackupItemBinding) =>
        sameBinding(v, b) && v.itemNo === b.itemNo && v.generation === b.generation
    return {
        snapshot: (input) =>
            call(
                "snapshot",
                input,
                BackupSnapshot,
                (v, now) =>
                    v.capturedAt <= now + 5000 &&
                    v.capturedAt >= input.context.observedAt - 5000 &&
                    (input.selected.includes("config") || !v.config.length) &&
                    (input.selected.includes("xp") || !v.xp.length),
            ),
        query: (input) =>
            call("query", input, BackupQueryResult, (v) => {
                const op = input.operation
                if (v.type !== op.type) return false
                if (v.type === "plan" && op.type === "plan")
                    return (
                        sameBinding(v.plan, op.binding) &&
                        v.plan.serverId === input.serverId &&
                        v.plan.ownerId === input.context.ownerId
                    )
                if (v.type === "item" && op.type === "item")
                    return (
                        matchesItem(v.item, op.binding) &&
                        (!v.object || "family" in v.object
                            ? !v.object || (v.object.family === v.item.family && v.object.sourceId === v.item.sourceId)
                            : v.object.sourceId === v.item.sourceId)
                    )
                if (v.type === "items" && op.type === "items")
                    return (
                        v.items.every((i) => sameBinding(i, op.binding)) &&
                        (!v.nextCursor || v.nextCursor !== op.cursor)
                    )
                if (v.type === "plans" && op.type === "plans")
                    return (
                        v.plans.every((p) => p.serverId === input.serverId && p.ownerId === input.context.ownerId) &&
                        (!v.nextCursor || v.nextCursor !== op.cursor)
                    )
                if (v.type === "origins" && op.type === "origins")
                    return (
                        v.origins.every((o) => o.serverId === input.serverId && o.provider === op.provider) &&
                        (!v.nextCursor || v.nextCursor !== op.cursor)
                    )
                // Each channel comes back at most once, and only if the request named it
                return (
                    v.type === "managed" &&
                    op.type === "managed" &&
                    unique(v.channels, (x) => x.id) &&
                    v.channels.every((x) => op.channelIds.includes(x.id))
                )
            }),
        preview: (input) =>
            call(
                "preview",
                input,
                BackupPreviewResult,
                (v) =>
                    v.plan.backupId === input.manifest.backupId &&
                    v.plan.archiveDigest === input.archiveDigest &&
                    v.plan.serverId === input.serverId &&
                    v.plan.ownerId === input.context.ownerId &&
                    v.plan.provider === input.manifest.provider,
            ),
        previewReady: (serverId) => call("preview-ready", { serverId }, BackupPreviewReadyResult, () => true),
        previewFailed: (serverId, requestedAt, failure) =>
            call("preview-failed", { serverId, requestedAt, failure }, BackupPreviewFailedResult, () => true),
        runStep: (input) => call("run-step", input, BackupPreviewFailedResult, () => true),
        manage: (input) =>
            call("manage", input, BackupManageResult, (v) => {
                const op = input.operation,
                    p = v.plan
                if (p.serverId !== input.serverId || p.ownerId !== input.context.ownerId) return false
                return (
                    sameBinding(p, op.binding) &&
                    (op.type === "confirm"
                        ? v.type === "confirmed" && p.confirmedAt !== undefined
                        : v.type === "forgotten" && p.forgotten)
                )
            }),
        work: (input) =>
            call("work", input, BackupWorkResult, (v, now) => {
                const op = input.operation
                if (!matchesItem(v.item, op.binding)) return false
                if (v.type === "item") return true
                const g = v.grant
                return (
                    (op.type === "reserve" || op.type === "claim") &&
                    matchesItem({ ...v.item, ...g }, op.binding) &&
                    g.serverId === input.serverId &&
                    g.ownerId === op.context.ownerId &&
                    g.botId === op.context.botId &&
                    g.sourceId === v.item.sourceId &&
                    g.channel.sourceId === v.item.sourceId &&
                    g.dispatchExpiresAt === v.item.dispatchExpiresAt &&
                    g.dispatchExpiresAt <= now + 120000 &&
                    g.dispatchExpiresAt > op.context.observedAt &&
                    (op.type === "claim" || !v.claimed)
                )
            }),
    }
}
