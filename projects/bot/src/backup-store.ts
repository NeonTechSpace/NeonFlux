import {
    BackupManageResult,
    BackupManifest,
    BackupOutcomeClaimResult,
    BackupPreviewFailedResult,
    BackupPreviewReadyResult,
    BackupPreviewResult,
    BackupQueryResult,
    BackupRunStepResult,
    BackupSnapshotPage,
    BackupWorkResult,
    type BackupBinding,
    type BackupItem,
    type BackupItemBinding,
    type BackupManageRequest,
    type BackupPreviewFailedRequest,
    type BackupPreviewSegmentRequest,
    type BackupPreviewStartRequest,
    type BackupQueryRequest,
    type BackupRunStepRequest,
    type BackupSnapshotPageRequest,
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
        return Schema.decodeUnknownSync(BackupManifest, { onExcessProperty: "error" })(value)
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
    snapshotPage(input: BackupSnapshotPageRequest): Effect.Effect<BackupSnapshotPage, BackupStoreError>
    query(input: BackupQueryRequest): Effect.Effect<BackupQueryResult, BackupStoreError>
    manage(input: BackupManageRequest): Effect.Effect<BackupManageResult, BackupStoreError>
    work(input: BackupWorkRequest): Effect.Effect<BackupWorkResult, BackupStoreError>
    previewStart(input: BackupPreviewStartRequest): Effect.Effect<BackupPreviewResult, BackupStoreError>
    previewSegment(input: BackupPreviewSegmentRequest): Effect.Effect<BackupPreviewResult, BackupStoreError>
    previewReady(serverId: string): Effect.Effect<BackupPreviewReadyResult, BackupStoreError>
    previewFailed(
        serverId: string,
        requestedAt: number,
        failure: BackupPreviewFailedRequest["failure"],
    ): Effect.Effect<BackupPreviewFailedResult, BackupStoreError>
    runStep(input: BackupRunStepRequest): Effect.Effect<BackupRunStepResult, BackupStoreError>
    /** Takes the outcome a run from chat that ended for lack of progress owes the owner, once */
    outcomeClaim(serverId: string, requestedAt: number): Effect.Effect<BackupOutcomeClaimResult, BackupStoreError>
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
        snapshotPage: (input) =>
            call(
                "snapshot-page",
                input,
                BackupSnapshotPage,
                (v, now) =>
                    v.capturedAt <= now + 5000 &&
                    v.capturedAt >= input.context.observedAt - 5000 &&
                    (input.selected.includes("config") || !v.config.length) &&
                    (input.selected.includes("xp") || !v.xp.length) &&
                    v.cursor !== input.cursor,
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
                if ((v.type === "items" && op.type === "items") || (v.type === "page" && op.type === "page"))
                    return (
                        v.items.every((i) => sameBinding(i, op.binding)) &&
                        (!v.nextCursor || v.nextCursor !== op.cursor)
                    )
                // Items still to start, and creations still to check, are never settled ones
                if (v.type === "open" && op.type === "open")
                    return v.items.every(
                        (i) => sameBinding(i, op.binding) && (i.state === "planned" || i.state === "reserved"),
                    )
                if (v.type === "unconfirmed" && op.type === "unconfirmed")
                    return v.items.every(
                        (i) =>
                            sameBinding(i, op.binding) &&
                            i.category === "structure" &&
                            i.disposition === "create" &&
                            i.mappedId !== null,
                    )
                if (v.type === "plans" && op.type === "plans")
                    return (
                        v.plans.every((p) => p.serverId === input.serverId && p.ownerId === input.context.ownerId) &&
                        (!v.nextCursor || v.nextCursor !== op.cursor)
                    )
                // Each mapping comes back at most once, and only for an archive channel the request named
                if (v.type === "origins" && op.type === "origins")
                    return (
                        unique(v.origins, (o) => o.sourceId) &&
                        v.origins.every(
                            (o) =>
                                o.serverId === input.serverId &&
                                o.provider === op.provider &&
                                op.sourceIds.includes(o.sourceId),
                        )
                    )
                // Each channel comes back at most once, and only if the request named it
                return (
                    v.type === "managed" &&
                    op.type === "managed" &&
                    unique(v.channels, (x) => x.id) &&
                    v.channels.every((x) => op.channelIds.includes(x.id))
                )
            }),
        previewStart: (input) =>
            call(
                "preview-start",
                input,
                BackupPreviewResult,
                (v) =>
                    v.plan.backupId === input.header.backupId &&
                    v.plan.archiveDigest === input.archiveDigest &&
                    v.plan.serverId === input.serverId &&
                    v.plan.ownerId === input.context.ownerId &&
                    v.plan.provider === input.header.provider,
            ),
        previewSegment: (input) =>
            call(
                "preview-segment",
                input,
                BackupPreviewResult,
                (v) => v.plan.serverId === input.serverId && v.plan.ownerId === input.context.ownerId,
            ),
        previewReady: (serverId) => call("preview-ready", { serverId }, BackupPreviewReadyResult, () => true),
        previewFailed: (serverId, requestedAt, failure) =>
            call("preview-failed", { serverId, requestedAt, failure }, BackupPreviewFailedResult, () => true),
        runStep: (input) => call("run-step", input, BackupRunStepResult, () => true),
        outcomeClaim: (serverId, requestedAt) =>
            call("outcome-claim", { serverId, requestedAt }, BackupOutcomeClaimResult, () => true),
        manage: (input) =>
            call("manage", input, BackupManageResult, (v) => {
                const op = input.operation,
                    p = v.plan
                if (p.serverId !== input.serverId || p.ownerId !== input.context.ownerId) return false
                return (
                    sameBinding(p, op.binding) &&
                    (op.type === "confirm"
                        ? v.type === "confirmed" && p.confirmedAt !== undefined && p.state === "ready"
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
                    // The order item moves channels by their IDs on the server, and a channel item names its own channel
                    (g.action === "order"
                        ? v.item.order === true && op.type === "claim"
                        : g.sourceId === v.item.sourceId && g.channel.sourceId === v.item.sourceId) &&
                    g.dispatchExpiresAt === v.item.dispatchExpiresAt &&
                    g.dispatchExpiresAt <= now + 120000 &&
                    g.dispatchExpiresAt > op.context.observedAt &&
                    (op.type === "claim" || !v.claimed)
                )
            }),
    }
}
