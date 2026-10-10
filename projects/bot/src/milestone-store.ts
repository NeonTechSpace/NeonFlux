import { MilestonesDeliveryResult, MilestonesManageResult, MilestonesPersonalResult, MilestonesQueryResult, type MilestonesDeliveryRequest, type MilestonesManageRequest, type MilestonesPersonalRequest,
    type MilestonesQueryRequest } from "@neonflux/contracts/milestones"
import { MilestonesDeliveryBinding } from "@neonflux/contracts/publishing-base"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export const sameMilestoneBinding = (a: MilestonesDeliveryBinding, b: MilestonesDeliveryBinding) => Object.keys(MilestonesDeliveryBinding.fields).every(k => a[k as keyof MilestonesDeliveryBinding] === b[k as keyof MilestonesDeliveryBinding])
export class MilestonesStoreError extends Data.TaggedError("MilestonesStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface MilestonesStore {
    manage(input: MilestonesManageRequest): Effect.Effect<MilestonesManageResult, MilestonesStoreError>
    query(input: MilestonesQueryRequest): Effect.Effect<MilestonesQueryResult, MilestonesStoreError>
    personal(input: MilestonesPersonalRequest): Effect.Effect<MilestonesPersonalResult, MilestonesStoreError>
    delivery(input: MilestonesDeliveryRequest): Effect.Effect<MilestonesDeliveryResult, MilestonesStoreError>
}
export function createMilestonesStore(config: BackendConfig): MilestonesStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (value: A) => boolean) => request(`/milestones/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })), Effect.filterOrFail(matches, () => new MilestonesStoreError({ operation, status: null })),
        Effect.mapError(error => new MilestonesStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        manage: input => call("manage", input, MilestonesManageResult, v => {
            if (v.duplicate) return true
            const op = input.operation
            if (op.type === "settings") return v.type === "settings" && v.settings.enabled === op.enabled && v.settings.revision === op.expectedRevision + 1
            if (op.type === "clear") return v.type === "cleared" && v.kind === op.kind
            if (op.type === "forget") return v.type === "forgotten"
            if (op.type === "reconcile") return v.type === "reconciled" && v.post.consumer?.type === "milestone" && sameMilestoneBinding(v.post.consumer, op.binding)
                && v.post.generation === op.expectedGeneration && v.post.attempt.attemptId === op.attemptId && v.post.messageId === op.observation.messageId && v.post.channelId === op.observation.channelId && v.post.botId === op.observation.botId
            if (v.type !== "route" || v.route.kind !== op.kind || (op.type === "configure" && op.expectedRevision === 0 ? v.route.revision < 1 : v.route.revision !== op.expectedRevision + 1)) return false
            const r = v.route
            if (op.type === "configure") return r.channelId === op.channelId && r.zone === op.zone && r.time === op.time && r.fold === op.fold && r.template.name === op.template.name && r.template.revision === op.template.revision
            return r.enabled === (op.type === "enable")
        }),
        query: input => call("query", input, MilestonesQueryResult, v => {
            const op = input.operation
            if (op.type === "settings" || op.type === "status") return v.type === op.type
            if (op.type === "preview") return v.type === "preview" && v.route.kind === op.kind
            return op.type === "deliveries" && v.type === "deliveries" && v.deliveries.every(d => d.kind === op.kind) && (!v.nextCursor || v.nextCursor !== op.cursor)
        }),
        personal: input => call("personal", input, MilestonesPersonalResult, v => {
            if (v.duplicate) return true
            const op = input.operation
            if (op.type === "me") return v.type === "me"
            if (op.type === "remove") return v.type === "removed"
            return v.type === "enrollment" && v.enrollment.kind === op.kind && v.enrollment.joinedAt === op.participant.member.joinedAt && v.enrollment.channelId === op.confirmChannelId
                && !v.enrollment.needsReconsent && (op.kind !== "birthday" || v.enrollment.monthDay === op.monthDay)
        }),
        delivery: input => call("delivery", input, MilestonesDeliveryResult, v => {
            const op = input.operation
            if (op.type === "list") return v.type === "deliveries" && v.hasMore === (v.nextCursor !== undefined) && (!v.nextCursor || !op.cursor || v.nextCursor.throughAt === op.cursor.throughAt && v.nextCursor.cursor !== op.cursor.cursor)
            if (op.type === "defer") return v.type === "progress" && v.nextCursor === undefined
            if (op.type === "membership") return v.type === "progress" && (v.hasMore === undefined && v.nextCursor === undefined || v.hasMore === (v.nextCursor !== undefined))
                && (!v.nextCursor || v.nextCursor.userId === op.binding.userId && v.nextCursor.joinedAt === op.binding.joinedAt && v.nextCursor.observedAt === op.observation.observedAt && v.nextCursor.cursor !== op.cursor?.cursor)
            if (op.type === "member-observation") return v.type === "progress" && v.nextCursor === undefined
            if (op.type === "member-targets") return v.type === "member-targets" && v.targets.every(t => t.userId === op.userId) && v.hasMore === (v.nextCursor !== undefined) && (!v.nextCursor || v.nextCursor !== op.cursor)
            if (v.type !== "reservation") return false
            if (v.status !== "reserved") return true
            const g = v.grant
            return g.consumer?.type === "milestone" && sameMilestoneBinding(g.consumer, op.binding) && g.actorId === op.context.automation.botId && g.channelId === op.context.automation.channelId && g.botId === op.context.automation.botId
        }),
    }
}
export function milestonesErrorMessage(error: MilestonesStoreError) {
    if (error.status === 403) return "You can't do that with birthdays and anniversaries right now. Your permissions, consent, verification or the DEFCON level don't allow it"
    if (error.status === 404) return "That channel setting or post was not found. Status shows the configured channels"
    if (error.status === 409) return "Birthdays and anniversaries changed while this command ran, or a post is still being sent. Send the command again if it still applies. A post that is not confirmed yet is never sent twice or forgotten"
    if (error.status === 400) return "That change is not valid. Check the channel, the confirm step and the syntax in !milestone help"
    if (error.status === 429) return "This server has reached its limit of birthday and anniversary posts. Forget old posts to make room. Members can still remove their own dates"
    return "The change could not be confirmed. Check the status before you repeat it"
}
